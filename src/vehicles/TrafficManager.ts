import * as THREE from 'three';
import { Track } from '../environment/Track';
import { createTrafficCar, type NpcRig } from './CarFactory';
import { NPC } from '../game/Config';
import { clamp, damp, randRange } from '../core/MathUtils';
import type { Vehicle } from './Vehicle';

interface NpcCar {
  rig: NpcRig;
  distance: number;
  lane: number;
  lateral: number;
  targetLateral: number;
  speed: number;
  cruiseSpeed: number;
  wasAhead: boolean;
  laneChangeCooldown: number;
  /** Race progress in metres including completed laps. */
  progress: number;
}

/**
 * Traffic / rival AI.
 *
 * The cars are pure track-space agents: they hold an arc length, a lane and a
 * speed, which makes following the road, keeping distance and overtaking cheap
 * to compute. Cars that fall too far behind the player are recycled ahead so
 * the road always feels populated without simulating the whole loop.
 */
export class TrafficManager {
  readonly group = new THREE.Group();
  private readonly cars: NpcCar[] = [];
  private readonly track: Track;
  private readonly tmp = new THREE.Vector3();

  overtakes = 0;
  /** While true the field waits on the grid (used during the countdown). */
  frozen = false;
  onOvertake: (() => void) | null = null;
  onPlayerHit: ((impact: number) => void) | null = null;

  constructor(track: Track, count = NPC.count) {
    this.track = track;
    this.group.name = 'traffic';

    for (let i = 0; i < count; i++) {
      const color = NPC.colors[i % NPC.colors.length];
      const rig = createTrafficCar(color);
      this.group.add(rig.root);
      const lane = 1 + (i % 3);
      this.cars.push({
        rig,
        distance: (i / count) * track.totalLength,
        lane,
        lateral: track.laneOffset(lane),
        targetLateral: track.laneOffset(lane),
        speed: randRange(NPC.minSpeed, NPC.maxSpeed),
        cruiseSpeed: randRange(NPC.minSpeed, NPC.maxSpeed),
        wasAhead: false,
        laneChangeCooldown: randRange(2, 12),
        progress: 0,
      });
    }
  }

  /**
   * Lines the field up around the player. Progress is stored in the same
   * frame of reference the player uses (0 at the start line), so standings are
   * a straight numeric comparison.
   */
  reset(playerDistance: number): void {
    this.overtakes = 0;
    const half = Math.floor(this.cars.length / 2);
    this.cars.forEach((car, i) => {
      // Half the field starts ahead, half behind, with a clear gap around the
      // player so nobody is sitting on the grid inside the Z.
      const offset = i < half ? -45 - i * 42 : 45 + (i - half) * 48;
      car.distance = this.track.wrapDistance(playerDistance + offset);
      car.lane = 1 + (i % 3);
      car.lateral = this.track.laneOffset(car.lane);
      car.targetLateral = car.lateral;
      car.cruiseSpeed = randRange(NPC.minSpeed, NPC.maxSpeed);
      car.speed = car.cruiseSpeed;
      car.progress = offset;
      car.wasAhead = offset > 0;
    });
  }

  /** Race standing helper: how many cars are ahead of this progress value. */
  countAhead(progress: number): number {
    let n = 0;
    for (const car of this.cars) if (car.progress > progress) n++;
    return n;
  }

  update(dt: number, player: Vehicle, playerProgress: number): void {
    const playerDist = player.projection.distance;
    const playerLateral = player.projection.lateral;
    const playerSpeed = Math.max(0, player.physics.state.vLong);
    const px = player.position.x;
    const pz = player.position.z;

    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i];

      if (this.frozen) {
        car.speed = 0;
        this.placeCar(car);
        continue;
      }

      /* ---- recycle cars that drop far behind ---- */
      const rel = this.track.deltaDistance(car.distance, playerDist);
      if (rel < -420 || rel > 900) {
        const offset = randRange(220, 620);
        car.distance = this.track.wrapDistance(playerDist + offset);
        // `progress` is deliberately NOT teleported: it is the car's race
        // standing, which keeps accumulating from its own speed. Recycling only
        // moves the car's *visible* position so the road ahead stays busy.
        car.lane = 1 + Math.floor(Math.random() * 3);
        car.lateral = this.track.laneOffset(car.lane);
        car.targetLateral = car.lateral;
        car.cruiseSpeed = randRange(NPC.minSpeed, NPC.maxSpeed);
        car.wasAhead = true;
      }

      /* ---- keep distance from the car in front ---- */
      let desired = car.cruiseSpeed;
      for (let j = 0; j < this.cars.length; j++) {
        if (i === j) continue;
        const other = this.cars[j];
        const gap = this.track.deltaDistance(other.distance, car.distance);
        if (gap > 0 && gap < 34 && Math.abs(other.lateral - car.lateral) < 3.2) {
          desired = Math.min(desired, other.speed * clamp(gap / 34, 0.2, 1));
          // Try to slip into a neighbouring lane instead of just braking.
          if (car.laneChangeCooldown <= 0 && gap < 22) {
            const dir = car.lane <= 1 ? 1 : car.lane >= 3 ? -1 : Math.random() < 0.5 ? 1 : -1;
            const newLane = clamp(car.lane + dir, 1, 3);
            if (newLane !== car.lane) {
              car.lane = newLane;
              car.targetLateral = this.track.laneOffset(newLane);
              car.laneChangeCooldown = randRange(4, 9);
            }
          }
        }
      }

      /* ---- treat the player as traffic too ---- */
      const playerGap = this.track.deltaDistance(playerDist, car.distance);
      if (playerGap > 0 && playerGap < 32 && Math.abs(playerLateral - car.lateral) < 3.4) {
        // Never drive through the player: match their pace and try to go round.
        desired = Math.min(desired, playerSpeed * clamp(playerGap / 32, 0.05, 1));
        if (car.laneChangeCooldown <= 0 && playerGap < 24) {
          const away = playerLateral > car.lateral ? -1 : 1;
          const newLane = clamp(car.lane + away, 1, 3);
          if (newLane !== car.lane) {
            car.lane = newLane;
            car.targetLateral = this.track.laneOffset(newLane);
            car.laneChangeCooldown = randRange(3, 7);
          }
        }
      }

      // Slow down for tight corners, like a real driver would.
      const curve = Math.abs(this.track.curvatureAt(car.distance + 40));
      desired *= clamp(1 - curve * 34, 0.55, 1);

      car.laneChangeCooldown -= dt;
      car.speed = damp(car.speed, Math.max(0, desired), 1.6, dt);
      car.distance = this.track.wrapDistance(car.distance + car.speed * dt);
      car.progress += car.speed * dt;
      car.lateral = damp(car.lateral, car.targetLateral, 2.2, dt);

      /* ---- place in the world ---- */
      this.placeCar(car);

      const spin = (car.speed / 0.34) * dt;
      for (const w of car.rig.wheels) w.rotation.x -= spin;

      const braking = car.speed < car.cruiseSpeed - 2.5;
      car.rig.tailMaterial.emissiveIntensity = braking ? 3.4 : 1.2;

      /* ---- interactions with the player ---- */
      const dx = px - car.rig.root.position.x;
      const dz = pz - car.rig.root.position.z;
      const d2 = dx * dx + dz * dz;

      if (d2 < 9) {
        const d = Math.sqrt(d2) || 0.001;
        const nx = dx / d;
        const nz = dz / d;
        const overlap = 3 - d;
        const s = player.physics.state;

        // Split the separation between both cars, and move the NPC in *track*
        // space — otherwise it would keep advancing along the spline and grind
        // the player into the barrier.
        s.x += nx * overlap * 0.5;
        s.z += nz * overlap * 0.5;

        const carYaw = car.rig.root.rotation.y;
        const dirX = Math.sin(carYaw);
        const dirZ = Math.cos(carYaw);
        car.distance = this.track.wrapDistance(
          car.distance - (nx * dirX + nz * dirZ) * overlap * 0.5,
        );
        car.lateral -= (nx * dirZ - nz * dirX) * overlap * 0.5;
        car.targetLateral = car.lateral;

        // Rubbing panels should not stop the player dead — only a genuine
        // closing speed counts as a hit.
        const closing = player.physics.normalSpeed(nx, nz);
        const impact =
          closing > 2.6
            ? player.physics.applyCollision(nx, nz, 0.4, 0.02)
            : player.physics.applyCollision(nx, nz, 0, 0);

        // The struck car lifts off rather than shoving the player along.
        car.speed = Math.min(car.speed, Math.max(0, playerSpeed * 0.9));
        if (impact > 3) this.onPlayerHit?.(impact);
      }

      const isAhead = this.track.deltaDistance(car.distance, playerDist) > 0;
      if (car.wasAhead && !isAhead && d2 < 400) {
        this.overtakes++;
        this.onOvertake?.();
      }
      car.wasAhead = isAhead;
    }
  }

  /** Puts a car's mesh where its track-space state says it should be. */
  private placeCar(car: NpcCar): void {
    this.track.positionAt(car.distance, car.lateral, this.tmp);
    car.rig.root.position.set(this.tmp.x, this.tmp.y + 0.16, this.tmp.z);
    car.rig.root.rotation.y = this.track.headingAt(car.distance);
  }

  /** Positions for the mini-map. */
  forEachCar(cb: (x: number, z: number) => void): void {
    for (const car of this.cars) cb(car.rig.root.position.x, car.rig.root.position.z);
  }

  /**
   * Releases the per-car materials. Geometry is deliberately left alone —
   * it lives in a shared cache that later cars reuse.
   */
  dispose(): void {
    this.group.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (mesh.isMesh) {
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((m) => m.dispose());
      }
    });
    this.group.clear();
    this.cars.length = 0;
  }
}
