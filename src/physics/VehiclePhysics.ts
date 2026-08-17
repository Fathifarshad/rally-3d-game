import { VEHICLE } from '../game/Config';
import { clamp, damp, moveTowards } from '../core/MathUtils';

export interface VehicleInput {
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. +1 (right) */
  steer: number;
  handbrake: boolean;
  nitro: boolean;
}

export interface PhysicsState {
  x: number;
  z: number;
  y: number;
  yaw: number;
  /** signed forward speed, m/s */
  vLong: number;
  /** sideways slip velocity, m/s (negative = sliding left) */
  vLat: number;
  yawRate: number;
  gear: number;
  rpm: number;
  nitro: number;
  nitroActive: boolean;
  driftAngle: number;
  drifting: boolean;
  longAccel: number;
  latAccel: number;
  wheelSpin: number;
  steerAngle: number;
  onGround: boolean;
  vy: number;
}

/**
 * Arcade-simulation vehicle model.
 *
 * Rather than a full rigid-body solver this uses a stabilised bicycle model:
 * the kinematic yaw rate is capped by the grip circle, and whatever the tyres
 * cannot deliver becomes lateral slip velocity. That keeps the car controllable
 * at any frame rate while still producing genuine understeer, power/handbrake
 * oversteer and long, catchable drifts.
 */
export class VehiclePhysics {
  readonly state: PhysicsState = {
    x: 0,
    z: 0,
    y: 0,
    yaw: 0,
    vLong: 0,
    vLat: 0,
    yawRate: 0,
    gear: 1,
    rpm: VEHICLE.idleRpm,
    nitro: VEHICLE.nitroCapacity,
    nitroActive: false,
    driftAngle: 0,
    drifting: false,
    longAccel: 0,
    latAccel: 0,
    wheelSpin: 0,
    steerAngle: 0,
    onGround: true,
    vy: 0,
  };

  private steerValue = 0;
  private shiftCooldown = 0;
  private readonly lastValid = { x: 0, y: 0, z: 0, yaw: 0 };
  private warnedAboutReset = false;

  reset(x: number, y: number, z: number, yaw: number): void {
    const s = this.state;
    s.x = x;
    s.y = y;
    s.z = z;
    s.yaw = yaw;
    s.vLong = 0;
    s.vLat = 0;
    s.vy = 0;
    s.yawRate = 0;
    s.gear = 1;
    s.rpm = VEHICLE.idleRpm;
    s.nitro = VEHICLE.nitroCapacity;
    s.nitroActive = false;
    s.driftAngle = 0;
    s.drifting = false;
    s.longAccel = 0;
    s.latAccel = 0;
    s.steerAngle = 0;
    this.steerValue = 0;
    this.lastValid.x = x;
    this.lastValid.y = y;
    this.lastValid.z = z;
    this.lastValid.yaw = yaw;
  }

  get speed(): number {
    return Math.hypot(this.state.vLong, this.state.vLat);
  }

  /** Torque curve normalised to 0..1, peaking in the mid range. */
  private torqueFactor(rpm: number): number {
    const t = clamp(rpm / VEHICLE.maxRpm, 0, 1);
    // Flat-ish plateau between 0.35 and 0.85 of redline.
    return clamp(0.55 + 0.9 * Math.sin(Math.PI * clamp((t - 0.05) / 0.95, 0, 1)) - 0.2 * t, 0.25, 1);
  }

  update(dt: number, input: VehicleInput, groundHeight: number): void {
    const s = this.state;
    const V = VEHICLE;

    /* ---------------- steering ---------------- */
    const speedAbs = Math.abs(s.vLong);
    const speedT = clamp(speedAbs / V.maxSpeed, 0, 1);
    const maxSteer = V.maxSteerAngle + (V.minSteerAngle - V.maxSteerAngle) * Math.sqrt(speedT);

    const target = clamp(input.steer, -1, 1);
    const rate = Math.abs(target) > 0.01 ? V.steerSpeed : V.steerReturnSpeed;
    this.steerValue = moveTowards(this.steerValue, target, rate * dt);
    s.steerAngle = this.steerValue * maxSteer;

    /* ---------------- nitro ---------------- */
    const wantsNitro = input.nitro && s.nitro > 1 && s.vLong > -0.5;
    if (wantsNitro && (s.nitroActive || s.nitro > V.nitroMinToStart)) {
      s.nitroActive = true;
      s.nitro = Math.max(0, s.nitro - V.nitroDrain * dt);
      if (s.nitro <= 0) s.nitroActive = false;
    } else {
      s.nitroActive = false;
      s.nitro = Math.min(V.nitroCapacity, s.nitro + V.nitroRecharge * dt);
    }

    /* ---------------- gearbox ---------------- */
    this.updateGearbox(dt, input.throttle);

    /* ---------------- longitudinal forces ---------------- */
    const maxSpeed = V.maxSpeed + (s.nitroActive ? V.nitroMaxSpeedBonus : 0);
    let force = 0;

    const reversing = s.vLong < -0.2;
    const wantsReverse = input.brake > 0.1 && s.vLong < 0.6;

    if (wantsReverse) {
      // S doubles as reverse once the car has effectively stopped.
      if (s.vLong > 0.05) {
        force -= V.brakeForce * input.brake;
      } else if (-s.vLong < V.maxReverseSpeed) {
        force -= V.enginePower * V.reverseForceFactor * input.brake;
      }
    } else {
      if (input.brake > 0.01 && s.vLong > 0) force -= V.brakeForce * input.brake;
      if (reversing && input.throttle > 0.01) force += V.brakeForce * input.throttle;

      if (input.throttle > 0.01 && s.vLong < maxSpeed) {
        const fade = 1 - clamp((s.vLong / maxSpeed) ** 2.2, 0, 1);
        force += V.enginePower * this.torqueFactor(s.rpm) * input.throttle * fade;
      }
      if (s.nitroActive) {
        force += V.nitroForce * (1 - clamp((s.vLong / maxSpeed) ** 3, 0, 1));
      }
      if (input.throttle < 0.01 && input.brake < 0.01) {
        force -= Math.sign(s.vLong) * V.engineBrake * Math.min(1, speedAbs / 6);
      }
    }

    if (input.handbrake) {
      force -= Math.sign(s.vLong) * V.handbrakeForce * Math.min(1, speedAbs / 3);
    }

    // Resistances.
    force -= Math.sign(s.vLong) * V.dragCoefficient * s.vLong * s.vLong;
    force -= V.rollingResistance * s.vLong;

    const accel = force / V.mass;
    s.longAccel = accel;
    s.vLong += accel * dt;

    // Kill the jitter around standstill.
    if (Math.abs(s.vLong) < 0.12 && input.throttle < 0.02 && input.brake < 0.02) s.vLong = 0;
    s.vLong = clamp(s.vLong, -V.maxReverseSpeed, maxSpeed);

    /* ---------------- lateral / yaw ---------------- */
    const vl = s.vLong;
    const absV = Math.abs(vl);

    // Grip circle: hard braking and boosting eat into lateral capacity.
    let grip = V.frontGrip;
    if (input.handbrake) grip *= V.handbrakeGripFactor;
    else if (s.drifting) grip *= V.driftGripFactor;
    grip -= Math.min(3.5, input.brake * 2.4);
    grip = Math.max(2.5, grip);

    const kinematicYaw = (vl * Math.tan(s.steerAngle)) / V.wheelBase;
    const maxYaw = grip / Math.max(absV, 2.2);
    let yawTarget = clamp(kinematicYaw, -maxYaw, maxYaw);

    // Handbrake and power-on oversteer rotate the car beyond the grip limit.
    if (input.handbrake && absV > 3) yawTarget *= 1.7;
    if (input.throttle > 0.8 && absV > 12 && Math.abs(s.steerAngle) > 0.08) yawTarget *= 1.12;

    const yawLambda = absV < 1 ? 12 : 9;
    s.yawRate = damp(s.yawRate, yawTarget, yawLambda, dt);
    if (absV < 0.3) s.yawRate *= 0.82;
    s.yaw += s.yawRate * dt;

    // Lateral slip: whatever the tyres could not deliver pushes the car wide.
    const demand = Math.abs(kinematicYaw) * absV;
    const excess = Math.max(0, demand - grip);
    if (excess > 0) s.vLat -= Math.sign(s.steerAngle) * excess * dt * 1.15;
    if (input.handbrake && absV > 4) {
      const dir = Math.abs(s.steerAngle) > 0.02 ? Math.sign(s.steerAngle) : 0;
      s.vLat -= dir * absV * 0.75 * dt;
    }

    const latRecovery = input.handbrake ? 2.0 : s.drifting ? 4.2 : 8.0;
    s.vLat = damp(s.vLat, 0, latRecovery, dt);
    s.vLat = clamp(s.vLat, -28, 28);
    s.latAccel = vl * s.yawRate;

    s.driftAngle = Math.atan2(Math.abs(s.vLat), Math.max(absV, 0.5));
    s.drifting = s.driftAngle > 0.13 && absV > 7;

    /* ---------------- integrate ---------------- */
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    // forward = (sin, cos), right = (cos, -sin)
    const vx = sinY * s.vLong + cosY * s.vLat;
    const vz = cosY * s.vLong - sinY * s.vLat;
    s.x += vx * dt;
    s.z += vz * dt;

    /* ---------------- vertical ---------------- */
    const targetY = groundHeight;
    if (s.y > targetY + 0.05) {
      s.vy -= 24 * dt;
      s.y += s.vy * dt;
      s.onGround = false;
      if (s.y <= targetY) {
        s.y = targetY;
        s.vy = 0;
        s.onGround = true;
      }
    } else {
      // Suspension keeps the hull glued to the surface without popping.
      s.y = damp(s.y, targetY, 14, dt);
      s.vy = 0;
      s.onGround = true;
    }

    /* ---------------- wheels ---------------- */
    s.wheelSpin += (s.vLong / VEHICLE.wheelRadius) * dt;
    if (input.handbrake) s.wheelSpin -= (s.vLong / VEHICLE.wheelRadius) * dt * 0.85;

    this.guardState();
  }

  /**
   * Safety net: a single NaN anywhere in the chain would otherwise spread to
   * the camera, the HUD and the audio graph. If it ever happens the car is
   * restored to its last valid pose with the motion zeroed, which the player
   * experiences as a momentary stop rather than a broken game.
   */
  private guardState(): void {
    const s = this.state;
    const ok =
      Number.isFinite(s.x) &&
      Number.isFinite(s.y) &&
      Number.isFinite(s.z) &&
      Number.isFinite(s.yaw) &&
      Number.isFinite(s.vLong) &&
      Number.isFinite(s.vLat) &&
      Number.isFinite(s.yawRate) &&
      Number.isFinite(s.rpm);

    if (ok) {
      this.lastValid.x = s.x;
      this.lastValid.y = s.y;
      this.lastValid.z = s.z;
      this.lastValid.yaw = s.yaw;
      return;
    }

    if (!this.warnedAboutReset) {
      console.warn('[Physics] non-finite state recovered', { ...s });
      this.warnedAboutReset = true;
    }
    s.x = this.lastValid.x;
    s.y = this.lastValid.y;
    s.z = this.lastValid.z;
    s.yaw = this.lastValid.yaw;
    s.vLong = 0;
    s.vLat = 0;
    s.vy = 0;
    s.yawRate = 0;
    s.rpm = VEHICLE.idleRpm;
    s.gear = 0;
    s.driftAngle = 0;
    s.drifting = false;
    s.longAccel = 0;
    s.latAccel = 0;
    this.steerValue = 0;
  }

  private updateGearbox(dt: number, throttle: number): void {
    const s = this.state;
    const V = VEHICLE;
    this.shiftCooldown = Math.max(0, this.shiftCooldown - dt);

    const speed = Math.abs(s.vLong);
    const rpmFor = (gear: number): number =>
      (speed / (2 * Math.PI * V.wheelRadius)) * V.gearRatios[gear] * V.finalDrive * 60;

    if (s.vLong < -0.2) {
      s.gear = -1;
      s.rpm = clamp(V.idleRpm + speed * 320, V.idleRpm, V.maxRpm);
      return;
    }

    if (s.gear < 0) s.gear = 0;

    let rpm = rpmFor(s.gear);
    if (this.shiftCooldown === 0) {
      if (rpm > V.shiftUpRpm && s.gear < V.gearRatios.length - 1) {
        s.gear++;
        this.shiftCooldown = 0.32;
        rpm = rpmFor(s.gear);
      } else if (rpm < V.shiftDownRpm && s.gear > 0) {
        s.gear--;
        this.shiftCooldown = 0.32;
        rpm = rpmFor(s.gear);
      }
    }

    const idle = V.idleRpm + throttle * (speed < 0.6 ? 3400 : 400);
    s.rpm = damp(s.rpm, clamp(Math.max(rpm, idle), V.idleRpm, V.maxRpm), 12, dt);
  }

  /** Closing speed towards a surface whose outward normal is (nx, nz). */
  normalSpeed(nx: number, nz: number): number {
    const s = this.state;
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    const vx = sinY * s.vLong + cosY * s.vLat;
    const vz = cosY * s.vLong - sinY * s.vLat;
    return -(vx * nx + vz * nz);
  }

  /**
   * Applies an impact from a wall or another car; the normal points away from
   * the obstacle. Returns the closing speed so callers can scale sound, shake
   * and score penalties.
   *
   * @param absorb how much of the inbound speed bounces back
   * @param scrubFactor tangential speed loss per unit of impact — kept low so
   *        that *scraping* a guardrail slows you without ever pinning the car
   *        (the normal component alone is removed in that case).
   */
  applyCollision(nx: number, nz: number, absorb = 0.55, scrubFactor = 0.012): number {
    const s = this.state;
    const sinY = Math.sin(s.yaw);
    const cosY = Math.cos(s.yaw);
    let vx = sinY * s.vLong + cosY * s.vLat;
    let vz = cosY * s.vLong - sinY * s.vLat;

    const vn = vx * nx + vz * nz;
    if (vn >= 0) return 0;

    const impact = -vn;
    // Remove the inbound component and bounce a little of it back.
    vx -= vn * nx * (1 + absorb);
    vz -= vn * nz * (1 + absorb);

    if (scrubFactor > 0) {
      const scrub = clamp(1 - impact * scrubFactor, 0.6, 1);
      vx *= scrub;
      vz *= scrub;
    }

    s.vLong = sinY * vx + cosY * vz;
    s.vLat = cosY * vx - sinY * vz;
    // A hard hit unsettles the car; a graze barely does.
    s.yawRate *= impact > 6 ? 0.4 : 0.9;
    return impact;
  }
}
