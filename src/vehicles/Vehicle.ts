import * as THREE from 'three';
import { VehiclePhysics, type VehicleInput } from '../physics/VehiclePhysics';
import { CollisionSystem } from '../physics/CollisionSystem';
import { Track, type Projection } from '../environment/Track';
import { terrainHeight } from '../environment/Terrain';
import { createPlayerCar, type CarRig } from './CarFactory';
import type { LoadedCarModel } from '../core/AssetLoader';
import { smokeTexture } from '../core/TextureFactory';
import { clamp, damp, msToKmh, wrapAngle } from '../core/MathUtils';
import { TRACK, VEHICLE } from '../game/Config';

const BARRIER_OFFSET = TRACK.halfWidth + 1.0;
const SMOKE_PARTICLES = 90;
/** Closing speed (m/s) above which contact counts as a crash, not a scrape. */
const IMPACT_THRESHOLD = 2.6;

export interface CollisionEvent {
  impact: number;
  kind: string;
}

/**
 * The player's car: physics state, the visual rig, wall/prop collisions and
 * the effects that sell speed (tyre smoke, nitro flames, light emissives).
 */
export class Vehicle {
  readonly physics = new VehiclePhysics();
  readonly object = new THREE.Group();
  readonly rig: CarRig;

  readonly projection: Projection = { distance: 0, lateral: 0, index: 0 };
  /** Total distance driven this session, in metres. */
  odometer = 0;
  topSpeed = 0;
  offRoad = false;
  lastCollision: CollisionEvent | null = null;

  private readonly track: Track;
  private readonly collisions: CollisionSystem;

  private bodyPitch = 0;
  private bodyRoll = 0;
  private bodyBounce = 0;
  /** Seconds of continuous guardrail contact, used by the nose-in recovery. */
  private wallContact = 0;

  private readonly smoke: THREE.Points;
  private readonly smokeData: Array<{ life: number; vx: number; vy: number; vz: number }> = [];
  private smokeCursor = 0;

  private readonly nitroFlames: THREE.Mesh[] = [];
  private customWheels: THREE.Object3D[] = [];

  constructor(track: Track, collisions: CollisionSystem, model: LoadedCarModel | null, paint: number) {
    this.track = track;
    this.collisions = collisions;

    this.rig = createPlayerCar(paint);
    this.object.add(this.rig.root);

    if (model) {
      // Swap the procedural shell for the supplied GLB but keep the rig's
      // wheels/anchors when the model does not expose its own.
      this.rig.body.children
        .slice()
        .forEach((child) => {
          if (child !== this.rig.cockpitAnchor) this.rig.body.remove(child);
        });
      this.rig.body.add(model.scene);
      if (model.wheels.length >= 4) {
        this.customWheels = model.wheels;
        this.rig.wheelPivots.forEach((p) => (p.visible = false));
      }
      if (model.paintMaterials.length) {
        this.rig.paintMaterials.length = 0;
        model.paintMaterials.forEach((m) => {
          m.color.setHex(paint);
          this.rig.paintMaterials.push(m as unknown as THREE.MeshPhysicalMaterial);
        });
      }
    }

    /* ---- tyre smoke pool ---- */
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(SMOKE_PARTICLES * 3);
    for (let i = 0; i < SMOKE_PARTICLES; i++) {
      // Park unused particles far below the world instead of allocating and
      // freeing points every frame.
      pos[i * 3 + 1] = -999;
      this.smokeData.push({ life: 0, vx: 0, vy: 0, vz: 0 });
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const smokeMat = new THREE.PointsMaterial({
      map: smokeTexture(),
      size: 2.6,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      color: 0xcfd3d8,
    });
    this.smoke = new THREE.Points(geo, smokeMat);
    this.smoke.frustumCulled = false;

    /* ---- nitro flames ---- */
    const flameGeo = new THREE.ConeGeometry(0.10, 0.9, 10, 1, true);
    flameGeo.rotateX(Math.PI / 2);
    flameGeo.translate(0, 0, -0.45);
    this.rig.exhaustAnchors.forEach((anchor) => {
      const mat = new THREE.MeshBasicMaterial({
        color: 0x63b6ff,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const flame = new THREE.Mesh(flameGeo, mat);
      flame.visible = false;
      anchor.add(flame);
      this.nitroFlames.push(flame);
    });

    /* ---- headlights (real spot lights, cheap: two, shadowless) ---- */
    [-1, 1].forEach((s) => {
      const light = new THREE.SpotLight(0xdfe9ff, 3.2, 90, 0.42, 0.5, 1.4);
      light.position.set(s * 0.6, 0.66, 2.1);
      const target = new THREE.Object3D();
      target.position.set(s * 0.9, -0.4, 30);
      this.rig.body.add(light);
      this.rig.body.add(target);
      light.target = target;
    });
  }

  get smokeObject(): THREE.Points {
    return this.smoke;
  }

  get speedKmh(): number {
    return Math.abs(msToKmh(this.physics.state.vLong));
  }

  get position(): THREE.Vector3 {
    return this.object.position;
  }

  setPaint(color: number): void {
    this.rig.paintMaterials.forEach((m) => m.color.setHex(color));
  }

  /** Places the car on the racing line at a given arc length. */
  placeOnTrack(distance: number, lateral = 2.5): void {
    const p = new THREE.Vector3();
    this.track.positionAt(distance, lateral, p);
    const yaw = this.track.headingAt(distance);
    this.physics.reset(p.x, p.y + 0.14, p.z, yaw);
    this.bodyPitch = 0;
    this.bodyRoll = 0;
    this.syncObject();
    this.track.project(p.x, p.z, this.projection);
  }

  /** R key: back on the tarmac, facing the right way, without losing progress. */
  respawn(): void {
    const d = this.projection.distance;
    const lateral = clamp(this.projection.lateral, -TRACK.halfWidth + 2, TRACK.halfWidth - 2);
    const p = new THREE.Vector3();
    this.track.positionAt(d + 4, lateral, p);
    const yaw = this.track.headingAt(d + 4);
    this.physics.reset(p.x, p.y + 0.14, p.z, yaw);
    this.syncObject();
  }

  update(dt: number, input: VehicleInput): void {
    const s = this.physics.state;

    /* ---- ground under the car ---- */
    this.track.project(s.x, s.z, this.projection);
    const lat = Math.abs(this.projection.lateral);
    // The paved shoulder between the white line and the guardrail is still
    // "on the road": treating it as grass turned every barrier scrape into a
    // mud trap that could stop the car dead.
    this.offRoad = lat > TRACK.halfWidth + 0.9;
    const groundY = terrainHeight(s.x, s.z) + (lat < BARRIER_OFFSET ? 0.14 : 0.02);

    // Grass and gravel: less grip, more drag.
    const effInput: VehicleInput = this.offRoad
      ? { ...input, throttle: input.throttle * 0.85 }
      : input;

    this.physics.update(dt, effInput, groundY);
    if (this.offRoad) {
      s.vLong *= 1 - 0.32 * dt;
      s.vLat *= 1 - 0.15 * dt;
    }

    this.resolveBarriers(dt);
    this.resolveProps();

    const travelled = Math.abs(s.vLong) * dt;
    this.odometer += travelled;
    this.topSpeed = Math.max(this.topSpeed, this.speedKmh);

    this.updateBody(dt, input);
    this.updateWheels(dt, input);
    this.updateLights(input);
    this.updateNitroFlames(dt);
    this.updateSmoke(dt);
    this.syncObject();
  }

  /**
   * Keeps the car inside the guardrails.
   *
   * A real hit and a scrape are treated very differently: a proper impact
   * bounces and costs speed, while merely leaning on the barrier only cancels
   * the sideways velocity. Without that split, holding the wall at 120 km/h
   * would multiply the speed down every single physics step and pin the car.
   */
  private resolveBarriers(dt: number): void {
    const s = this.physics.state;
    const limit = BARRIER_OFFSET - 0.95;
    const lat = this.projection.lateral;
    const absLat = Math.abs(lat);

    // Hysteresis: a car resting on the barrier sits *exactly* on the limit, so
    // a strict `> limit` test flickers on and off between frames and the
    // recovery below would never accumulate any contact time.
    if (absLat < limit - 0.12) {
      this.wallContact = Math.max(0, this.wallContact - dt * 3);
      return;
    }
    this.wallContact += dt;

    const frame = TMP_FRAME;
    this.track.frameAt(this.projection.distance, frame);
    const sign = Math.sign(lat) || 1;
    const nx = -frame.side.x * sign;
    const nz = -frame.side.z * sign;

    if (absLat > limit) {
      const push = absLat - limit;
      s.x -= frame.side.x * sign * push;
      s.z -= frame.side.z * sign * push;

      const closing = this.physics.normalSpeed(nx, nz);
      if (closing > IMPACT_THRESHOLD) {
        const impact = this.physics.applyCollision(nx, nz, 0.25, 0.02);
        this.lastCollision = { impact, kind: 'barrier' };
      } else {
        // Scraping: shed the sideways component, keep rolling forward.
        this.physics.applyCollision(nx, nz, 0, 0);
        s.vLong *= 0.995;
      }
      this.projection.lateral = limit * sign;
    }

    /**
     * The barrier physically guides the car parallel to itself, and once the
     * car is down to walking pace it also nudges it back onto the tarmac.
     * Without this a nose-in contact is a dead end: yaw rate needs forward
     * speed, so a stopped car cannot rotate away from the wall and the player
     * would be stuck with the throttle pinned.
     */
    const roadYaw = this.track.headingAt(this.projection.distance);
    const diff = wrapAngle(roadYaw - s.yaw);
    const crawling = Math.abs(s.vLong) < 3.5;
    s.yaw += diff * Math.min(1, (crawling ? 2.4 : 1.0) * dt);

    if (crawling && this.wallContact > 0.3) {
      s.x -= frame.side.x * sign * 2.2 * dt;
      s.z -= frame.side.z * sign * 2.2 * dt;
    }
  }

  /** Trees, lamp posts, buildings and signs. Two circles approximate the hull. */
  private resolveProps(): void {
    const s = this.physics.state;
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    for (let i = 0; i < 2; i++) {
      const off = i === 0 ? 1.2 : -1.2;
      const px = s.x + sinY * off;
      const pz = s.z + cosY * off;
      const hit = this.collisions.query(px, pz, 0.95);
      if (!hit) continue;
      s.x += hit.nx * hit.depth;
      s.z += hit.nz * hit.depth;
      const closing = this.physics.normalSpeed(hit.nx, hit.nz);
      if (closing > IMPACT_THRESHOLD) {
        const impact = this.physics.applyCollision(hit.nx, hit.nz, 0.35, 0.03);
        this.lastCollision = { impact, kind: hit.collider.kind };
      } else {
        this.physics.applyCollision(hit.nx, hit.nz, 0, 0);
      }
    }
  }

  private updateBody(dt: number, input: VehicleInput): void {
    const s = this.physics.state;
    const V = VEHICLE;

    const targetPitch = clamp(-s.longAccel * V.bodyPitchFactor, -0.09, 0.09);
    const targetRoll = clamp(s.latAccel * V.bodyRollFactor, -0.12, 0.12);
    this.bodyPitch = damp(this.bodyPitch, targetPitch, V.suspensionDamping, dt);
    this.bodyRoll = damp(this.bodyRoll, targetRoll, V.suspensionDamping, dt);

    // Road texture: a little vertical chatter that scales with speed.
    const chatter = this.offRoad ? 0.035 : 0.006;
    this.bodyBounce = damp(
      this.bodyBounce,
      Math.sin(performance.now() * 0.021) * chatter * clamp(Math.abs(s.vLong) / 25, 0, 1),
      8,
      dt,
    );

    this.rig.body.rotation.set(this.bodyPitch, 0, -this.bodyRoll);
    this.rig.body.position.y = this.bodyBounce;
  }

  private updateWheels(dt: number, input: VehicleInput): void {
    const s = this.physics.state;
    const steer = s.steerAngle;

    if (this.customWheels.length >= 4) {
      this.customWheels.forEach((w, i) => {
        w.rotation.x = -s.wheelSpin;
        if (i < 2) w.rotation.y = steer;
      });
      return;
    }

    this.rig.wheelPivots.forEach((pivot, i) => {
      if (i < 2) pivot.rotation.y = steer;
      // Suspension travel: the loaded side compresses.
      const side = i % 2 === 0 ? -1 : 1;
      const front = i < 2 ? 1 : -1;
      const compress =
        clamp(s.latAccel * 0.006 * side + s.longAccel * 0.004 * front, -0.05, 0.05);
      pivot.position.y = VEHICLE.wheelRadius - compress;
    });
    this.rig.wheelSpins.forEach((spin) => {
      spin.rotation.x = -s.wheelSpin;
    });

    if (this.rig.steeringWheel) {
      this.rig.steeringWheel.rotation.z = -steer * 3.6;
    }
  }

  private updateLights(input: VehicleInput): void {
    const s = this.physics.state;
    const braking = input.brake > 0.05 && s.vLong > 0.2;
    this.rig.brakeLightMaterials.forEach((m) => {
      m.emissiveIntensity = damp(m.emissiveIntensity, braking ? 4.2 : 1.1, 18, 0.016);
    });
    this.rig.reverseLightMaterials.forEach((m) => {
      m.emissiveIntensity = s.gear < 0 ? 2.6 : 0;
    });
  }

  private updateNitroFlames(dt: number): void {
    const active = this.physics.state.nitroActive;
    this.nitroFlames.forEach((flame, i) => {
      const mat = flame.material as THREE.MeshBasicMaterial;
      const target = active ? 0.85 : 0;
      mat.opacity = damp(mat.opacity, target, 14, dt);
      flame.visible = mat.opacity > 0.02;
      if (flame.visible) {
        const flicker = 0.75 + Math.random() * 0.5;
        flame.scale.set(flicker, flicker, 0.8 + Math.random() * 0.7);
        mat.color.setHSL(0.56 + Math.random() * 0.04, 1, 0.62 + Math.random() * 0.15);
      }
    });
    this.rig.headlightGlows.forEach((sprite) => {
      const mat = sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.26 + Math.sin(performance.now() * 0.004 + sprite.position.x) * 0.03;
    });
  }

  private updateSmoke(dt: number): void {
    const s = this.physics.state;
    const pos = this.smoke.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;

    const emitting = (s.drifting || (this.offRoad && Math.abs(s.vLong) > 8)) && s.onGround;
    if (emitting) {
      const emitCount = this.offRoad ? 2 : 3;
      const sinY = Math.sin(s.yaw);
      const cosY = Math.cos(s.yaw);
      for (let e = 0; e < emitCount; e++) {
        const i = this.smokeCursor;
        this.smokeCursor = (this.smokeCursor + 1) % SMOKE_PARTICLES;
        const side = e % 2 === 0 ? -1 : 1;
        const ox = sinY * -1.24 + cosY * side * 0.78;
        const oz = cosY * -1.24 - sinY * side * 0.78;
        arr[i * 3] = s.x + ox;
        arr[i * 3 + 1] = s.y + 0.12;
        arr[i * 3 + 2] = s.z + oz;
        const d = this.smokeData[i];
        d.life = 1;
        d.vx = (Math.random() - 0.5) * 2.2 - sinY * s.vLong * 0.06;
        d.vy = 0.7 + Math.random() * 0.9;
        d.vz = (Math.random() - 0.5) * 2.2 - cosY * s.vLong * 0.06;
      }
    }

    let anyAlive = false;
    for (let i = 0; i < SMOKE_PARTICLES; i++) {
      const d = this.smokeData[i];
      if (d.life <= 0) continue;
      anyAlive = true;
      d.life -= dt * 0.75;
      if (d.life <= 0) {
        arr[i * 3 + 1] = -999;
        continue;
      }
      arr[i * 3] += d.vx * dt;
      arr[i * 3 + 1] += d.vy * dt;
      arr[i * 3 + 2] += d.vz * dt;
      d.vx *= 1 - 1.6 * dt;
      d.vz *= 1 - 1.6 * dt;
      d.vy *= 1 - 0.6 * dt;
    }
    (this.smoke.material as THREE.PointsMaterial).opacity = 0.42;
    this.smoke.visible = anyAlive;
    pos.needsUpdate = true;
  }

  private syncObject(): void {
    const s = this.physics.state;
    this.object.position.set(s.x, s.y, s.z);
    this.object.rotation.y = s.yaw;

    // Follow the terrain slope so the car does not float on hills.
    const ahead = terrainHeight(s.x + Math.sin(s.yaw) * 2, s.z + Math.cos(s.yaw) * 2);
    const behind = terrainHeight(s.x - Math.sin(s.yaw) * 2, s.z - Math.cos(s.yaw) * 2);
    this.object.rotation.x = Math.atan2(behind - ahead, 4) * 0.9;

    const left = terrainHeight(s.x + Math.cos(s.yaw) * 1.2, s.z - Math.sin(s.yaw) * 1.2);
    const right = terrainHeight(s.x - Math.cos(s.yaw) * 1.2, s.z + Math.sin(s.yaw) * 1.2);
    this.object.rotation.z = Math.atan2(left - right, 2.4) * 0.9;
    this.object.rotation.order = 'YXZ';
  }

  /** Cockpit camera anchor in world space. */
  getCockpitPosition(out: THREE.Vector3): THREE.Vector3 {
    return this.rig.cockpitAnchor.getWorldPosition(out);
  }

  getForward(out: THREE.Vector3): THREE.Vector3 {
    const s = this.physics.state;
    return out.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  }

  consumeCollision(): CollisionEvent | null {
    const c = this.lastCollision;
    this.lastCollision = null;
    return c;
  }
}

const TMP_FRAME = {
  pos: new THREE.Vector3(),
  dir: new THREE.Vector3(),
  side: new THREE.Vector3(),
};
