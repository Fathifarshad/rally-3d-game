/**
 * Central tuning file. Every "magic number" of the game lives here so the
 * project stays easy to balance without hunting through systems.
 */

export type QualityLevel = 'low' | 'medium' | 'high';

export interface QualitySettings {
  shadows: boolean;
  shadowMapSize: number;
  bloom: boolean;
  pixelRatioCap: number;
  treeCount: number;
  buildingCount: number;
  streetLightSpacing: number;
  cloudCount: number;
  anisotropy: number;
  drawDistance: number;
}

export const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    shadows: false,
    shadowMapSize: 1024,
    bloom: false,
    pixelRatioCap: 1,
    treeCount: 260,
    buildingCount: 60,
    streetLightSpacing: 160,
    cloudCount: 24,
    anisotropy: 2,
    drawDistance: 1400,
  },
  medium: {
    shadows: true,
    shadowMapSize: 2048,
    bloom: true,
    pixelRatioCap: 1.5,
    treeCount: 620,
    buildingCount: 130,
    streetLightSpacing: 110,
    cloudCount: 40,
    anisotropy: 8,
    drawDistance: 2200,
  },
  high: {
    shadows: true,
    shadowMapSize: 4096,
    bloom: true,
    pixelRatioCap: 2,
    treeCount: 1100,
    buildingCount: 220,
    streetLightSpacing: 80,
    cloudCount: 60,
    anisotropy: 16,
    drawDistance: 3000,
  },
};

/** Vehicle tuning — arcade-simulation values (SI units unless noted). */
export const VEHICLE = {
  mass: 1620,                 // kg (Nissan Z, roughly)
  wheelBase: 2.55,            // m
  wheelRadius: 0.35,          // m

  enginePower: 24500,         // N of drive force at peak
  reverseForceFactor: 0.42,
  brakeForce: 26000,          // N
  handbrakeForce: 14000,      // N
  engineBrake: 3200,          // N

  maxSpeed: 82,               // m/s  (~295 km/h)
  maxReverseSpeed: 14,        // m/s
  dragCoefficient: 0.42,      // air drag (F = c * v^2)
  rollingResistance: 9.5,     // F = c * v

  maxSteerAngle: 0.62,        // rad at standstill
  minSteerAngle: 0.13,        // rad at top speed
  steerSpeed: 3.4,            // rad/s of steering-wheel slew
  steerReturnSpeed: 5.2,

  frontGrip: 12.5,
  rearGrip: 13.2,
  handbrakeGripFactor: 0.32,
  driftGripFactor: 0.72,

  nitroForce: 15500,          // extra N while boosting
  nitroMaxSpeedBonus: 12,     // m/s over the normal limit
  nitroCapacity: 100,
  nitroDrain: 26,             // per second
  nitroRecharge: 9,           // per second
  nitroMinToStart: 12,

  gearRatios: [3.83, 2.36, 1.69, 1.31, 1.0, 0.84],
  finalDrive: 3.13,
  idleRpm: 800,
  maxRpm: 7500,
  shiftUpRpm: 6900,
  shiftDownRpm: 2700,

  suspensionDamping: 5.5,
  bodyRollFactor: 0.055,
  bodyPitchFactor: 0.035,
};

export const TRACK = {
  halfWidth: 9,               // 4 lanes of 4.5 m
  laneCount: 4,
  guardrailInset: 0.55,       // barrier sits this far outside the tarmac edge
  checkpointCount: 12,
  laps: 2,
};

export const SCORING = {
  perCheckpoint: 250,
  perOvertake: 120,
  driftPerSecond: 160,
  nitroPerSecond: 45,
  speedBonusPerSecond: 30,   // while above 200 km/h
  collisionPenalty: 90,
  missionComplete: 1000,
  lapComplete: 750,
};

export const CAMERA = {
  fov: 62,
  near: 0.2,
  far: 4000,
  speedFovBonus: 13,
};

export const NPC = {
  count: 14,
  minSpeed: 16,
  maxSpeed: 34,
  colors: [0x9aa3ad, 0x1c2026, 0xb4322f, 0x27476b, 0xd8d8d8, 0x2f5c3f, 0xc9a227],
};
