import { SCORING } from '../game/Config';

export interface ScoreEvent {
  label: string;
  points: number;
  tone: 'good' | 'warn' | 'neutral';
}

/**
 * Score accumulation and the "+points" feed shown in the HUD.
 * Continuous sources (drifting, boosting, going fast) accrue per second;
 * discrete ones (checkpoints, overtakes, crashes) come in as one-shots.
 */
export class ScoreManager {
  score = 0;
  driftChain = 0;

  private pendingEvents: ScoreEvent[] = [];
  private fractional = 0;

  reset(): void {
    this.score = 0;
    this.driftChain = 0;
    this.fractional = 0;
    this.pendingEvents.length = 0;
  }

  add(points: number, label?: string, tone: ScoreEvent['tone'] = 'good'): void {
    this.score = Math.max(0, this.score + Math.round(points));
    if (label) this.pendingEvents.push({ label, points: Math.round(points), tone });
  }

  /** Continuous scoring; returns the drift chain length in seconds. */
  update(
    dt: number,
    telemetry: { drifting: boolean; speedKmh: number; nitroActive: boolean },
  ): void {
    let rate = 0;
    if (telemetry.drifting) {
      this.driftChain += dt;
      // Longer drifts pay progressively better, capped at 3x.
      rate += SCORING.driftPerSecond * Math.min(3, 1 + this.driftChain * 0.25);
    } else if (this.driftChain > 0) {
      if (this.driftChain > 1.2) {
        this.add(
          Math.round(this.driftChain * 120),
          `DRIFT ${this.driftChain.toFixed(1)}S`,
          'good',
        );
      }
      this.driftChain = 0;
    }

    if (telemetry.speedKmh > 200) rate += SCORING.speedBonusPerSecond;
    if (telemetry.nitroActive) rate += SCORING.nitroPerSecond;

    this.fractional += rate * dt;
    const whole = Math.floor(this.fractional);
    if (whole > 0) {
      this.score += whole;
      this.fractional -= whole;
    }
  }

  checkpoint(): void {
    this.add(SCORING.perCheckpoint, `CHECKPOINT +${SCORING.perCheckpoint}`, 'good');
  }

  overtake(): void {
    this.add(SCORING.perOvertake, `OVERTAKE +${SCORING.perOvertake}`, 'good');
  }

  lap(): void {
    this.add(SCORING.lapComplete, `LAP BONUS +${SCORING.lapComplete}`, 'good');
  }

  collision(impact: number): void {
    const penalty = Math.round(SCORING.collisionPenalty * Math.min(2, impact / 12));
    if (penalty <= 0) return;
    this.add(-penalty, `CRASH -${penalty}`, 'warn');
    this.driftChain = 0;
  }

  drainEvents(): ScoreEvent[] {
    const out = this.pendingEvents;
    this.pendingEvents = [];
    return out;
  }
}
