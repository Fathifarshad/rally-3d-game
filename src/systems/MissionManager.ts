import { SCORING } from '../game/Config';

export interface Mission {
  id: string;
  title: string;
  /** Target value in the mission's own unit. */
  target: number;
  unit: string;
  reward: number;
  progress: number;
  complete: boolean;
  format: (progress: number, target: number) => string;
}

export interface MissionSnapshot {
  index: number;
  total: number;
  title: string;
  ratio: number;
  label: string;
  complete: boolean;
}

/**
 * Objective list. Missions are evaluated from live telemetry every frame, so
 * they need no hooks into the driving code — they just read the numbers.
 */
export class MissionManager {
  readonly missions: Mission[] = [
    {
      id: 'speed',
      title: 'Reach 200 KM/H',
      target: 200,
      unit: 'km/h',
      reward: 1200,
      progress: 0,
      complete: false,
      format: (p, t) => `${Math.floor(p)} / ${t} KM/H`,
    },
    {
      id: 'distance',
      title: 'Drive 5 KM',
      target: 5000,
      unit: 'm',
      reward: 1500,
      progress: 0,
      complete: false,
      format: (p, t) => `${(p / 1000).toFixed(2)} / ${(t / 1000).toFixed(0)} KM`,
    },
    {
      id: 'overtake',
      title: 'Overtake 10 Cars',
      target: 10,
      unit: 'cars',
      reward: 1800,
      progress: 0,
      complete: false,
      format: (p, t) => `${Math.floor(p)} / ${t} CARS`,
    },
    {
      id: 'drift',
      title: 'Drift for 20 Seconds',
      target: 20,
      unit: 's',
      reward: 1600,
      progress: 0,
      complete: false,
      format: (p, t) => `${p.toFixed(1)} / ${t} S`,
    },
    {
      id: 'race',
      title: 'Complete the Race',
      target: 1,
      unit: '',
      reward: 4000,
      progress: 0,
      complete: false,
      format: (p) => (p >= 1 ? 'FINISHED' : 'IN PROGRESS'),
    },
  ];

  onComplete: ((mission: Mission) => void) | null = null;

  private driftTime = 0;

  reset(): void {
    this.driftTime = 0;
    this.missions.forEach((m) => {
      m.progress = 0;
      m.complete = false;
    });
  }

  update(
    dt: number,
    telemetry: {
      speedKmh: number;
      distance: number;
      overtakes: number;
      drifting: boolean;
      raceFinished: boolean;
    },
  ): number {
    if (telemetry.drifting) this.driftTime += dt;

    let earned = 0;
    for (const m of this.missions) {
      if (m.complete) continue;
      switch (m.id) {
        case 'speed':
          m.progress = Math.max(m.progress, telemetry.speedKmh);
          break;
        case 'distance':
          m.progress = telemetry.distance;
          break;
        case 'overtake':
          m.progress = telemetry.overtakes;
          break;
        case 'drift':
          m.progress = this.driftTime;
          break;
        case 'race':
          m.progress = telemetry.raceFinished ? 1 : 0;
          break;
        default:
          break;
      }
      if (m.progress >= m.target) {
        m.complete = true;
        earned += m.reward + SCORING.missionComplete;
        this.onComplete?.(m);
      }
    }
    return earned;
  }

  /** The objective shown in the HUD: first unfinished, else the last one. */
  current(): MissionSnapshot {
    const index = this.missions.findIndex((m) => !m.complete);
    const i = index === -1 ? this.missions.length - 1 : index;
    const m = this.missions[i];
    return {
      index: i,
      total: this.missions.length,
      title: m.title,
      ratio: Math.min(1, m.progress / m.target),
      label: m.format(m.progress, m.target),
      complete: m.complete,
    };
  }

  get completedCount(): number {
    return this.missions.filter((m) => m.complete).length;
  }
}
