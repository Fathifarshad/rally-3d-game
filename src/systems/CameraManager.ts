import * as THREE from 'three';
import { CAMERA, VEHICLE } from '../game/Config';
import { clamp, damp } from '../core/MathUtils';
import type { Vehicle } from '../vehicles/Vehicle';

export type CameraMode = 'third' | 'chase' | 'cockpit';

const MODES: CameraMode[] = ['third', 'chase', 'cockpit'];

const MODE_LABEL: Record<CameraMode, string> = {
  third: 'THIRD PERSON',
  chase: 'CHASE CAM',
  cockpit: 'COCKPIT',
};

/**
 * Three driving cameras plus the garage/menu orbit.
 *
 * The follow cameras are spring-damped in world space and lean into the car's
 * slip angle, so drifting actually looks like drifting. FOV widens with speed
 * and nitro to sell the acceleration.
 */
export class CameraManager {
  readonly camera: THREE.PerspectiveCamera;
  mode: CameraMode = 'third';

  private readonly position = new THREE.Vector3();
  private readonly lookAt = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly targetLook = new THREE.Vector3();
  private readonly tmp = new THREE.Vector3();
  private shake = 0;
  private fov = CAMERA.fov;
  private initialised = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, aspect, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 6, -12);
    this.camera.rotation.order = 'YXZ';
  }

  get label(): string {
    return MODE_LABEL[this.mode];
  }

  cycle(): CameraMode {
    const i = MODES.indexOf(this.mode);
    this.mode = MODES[(i + 1) % MODES.length];
    this.initialised = false;
    return this.mode;
  }

  setMode(mode: CameraMode): void {
    this.mode = mode;
    this.initialised = false;
  }

  addShake(amount: number): void {
    this.shake = Math.min(1.4, this.shake + amount);
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(dt: number, vehicle: Vehicle): void {
    const s = vehicle.physics.state;
    const speed = Math.abs(s.vLong);
    const speedT = clamp(speed / VEHICLE.maxSpeed, 0, 1);

    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const carPos = vehicle.object.position;

    if (this.mode === 'cockpit') {
      vehicle.getCockpitPosition(this.desired);
      this.targetLook
        .copy(this.desired)
        .add(this.tmp.set(sinY * 16, -0.35, cosY * 16))
        // Look slightly into the corner the driver is steering towards.
        .add(this.tmp.set(cosY * s.steerAngle * 9, 0, -sinY * s.steerAngle * 9));

      this.position.copy(this.desired);
      this.lookAt.lerp(this.targetLook, 1 - Math.exp(-14 * dt));
    } else {
      const chase = this.mode === 'chase';
      const dist = chase ? 9.4 + speedT * 4.2 : 7.4 + speedT * 2.6;
      const height = chase ? 2.6 + speedT * 0.9 : 3.1;
      const lambda = chase ? 3.4 + speedT * 2.4 : 7.5;

      /*
       * A damped follow camera always trails its target by roughly v/λ, which
       * at 150 km/h is several car lengths — the car ends up a distant speck.
       * Feeding the car's velocity forward by exactly that amount cancels the
       * steady-state error, so the framing stays constant at any speed while
       * the spring still absorbs bumps and direction changes.
       */
      const vx = sinY * s.vLong + cosY * s.vLat;
      const vz = cosY * s.vLong - sinY * s.vLat;
      const lead = 1 / lambda;

      // Sit behind the car, but swing wide when the tail steps out.
      const driftLean = clamp(s.vLat * 0.11, -2.6, 2.6);
      this.desired.set(
        carPos.x - sinY * dist + cosY * driftLean + vx * lead,
        carPos.y + height,
        carPos.z - cosY * dist - sinY * driftLean + vz * lead,
      );
      if (!this.initialised) {
        this.position.copy(this.desired);
        this.lookAt.copy(carPos);
        this.initialised = true;
      }
      this.position.x = damp(this.position.x, this.desired.x, lambda, dt);
      this.position.y = damp(this.position.y, this.desired.y, lambda * 1.4, dt);
      this.position.z = damp(this.position.z, this.desired.z, lambda, dt);

      this.targetLook.set(
        carPos.x + sinY * (6 + speedT * 10),
        carPos.y + 1.1,
        carPos.z + cosY * (6 + speedT * 10),
      );
      this.lookAt.lerp(this.targetLook, 1 - Math.exp(-(chase ? 5 : 9) * dt));
    }

    /* ---- shake: impacts, kerbs and raw speed ---- */
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const rumble = (vehicle.offRoad ? 0.05 : 0.012) * speedT + this.shake * 0.22;
    if (rumble > 0.001) {
      const t = performance.now() * 0.05;
      this.position.x += Math.sin(t * 1.7) * rumble;
      this.position.y += Math.cos(t * 2.3) * rumble;
    }

    this.camera.position.copy(this.position);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.lookAt);

    // A touch of roll in the follow cameras makes cornering feel weightier.
    if (this.mode !== 'cockpit') {
      this.camera.rotateZ(clamp(-s.latAccel * 0.008, -0.06, 0.06));
    } else {
      this.camera.rotateZ(clamp(-s.latAccel * 0.004, -0.03, 0.03));
    }

    const targetFov =
      CAMERA.fov +
      speedT * CAMERA.speedFovBonus +
      (s.nitroActive ? 7 : 0) +
      (this.mode === 'cockpit' ? -6 : 0);
    this.fov = damp(this.fov, targetFov, 4, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  /** Slow orbit used by the main menu and the garage. */
  orbit(target: THREE.Vector3, radius: number, height: number, angle: number, lookHeight = 0.8): void {
    this.camera.position.set(
      target.x + Math.sin(angle) * radius,
      target.y + height,
      target.z + Math.cos(angle) * radius,
    );
    this.camera.lookAt(target.x, target.y + lookHeight, target.z);
    if (this.camera.fov !== CAMERA.fov) {
      this.camera.fov = CAMERA.fov;
      this.fov = CAMERA.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
