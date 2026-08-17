import { Track } from '../environment/Track';
import { TRACK } from '../game/Config';

export type RaceState = 'idle' | 'countdown' | 'running' | 'finished';

export interface RaceResult {
  time: number;
  position: number;
  laps: number;
  checkpoints: number;
}

/**
 * Race director: countdown, checkpoint gates, lap counting and the finish.
 *
 * Progress is tracked as a monotonically increasing distance (laps × track
 * length + arc position) which makes checkpoints, laps and standings all
 * comparisons on a single number, immune to the wrap at the start/finish line.
 */
export class RaceManager {
  state: RaceState = 'idle';
  time = 0;
  countdown = 0;
  lap = 1;
  checkpointIndex = 0;
  checkpointsPassed = 0;
  position = 1;

  private readonly spacing: number;
  private startProgress = 0;

  onCountdown: ((n: number) => void) | null = null;
  onCheckpoint: ((index: number, total: number) => void) | null = null;
  onLap: ((lap: number, total: number) => void) | null = null;
  onFinish: ((result: RaceResult) => void) | null = null;

  constructor(track: Track) {
    this.spacing = track.totalLength / TRACK.checkpointCount;
  }

  begin(startProgress: number): void {
    this.state = 'countdown';
    this.countdown = 3.999;
    this.time = 0;
    this.lap = 1;
    this.checkpointIndex = 0;
    this.checkpointsPassed = 0;
    this.position = 1;
    this.startProgress = startProgress;
    this.onCountdown?.(3);
  }

  get totalCheckpoints(): number {
    return TRACK.checkpointCount * TRACK.laps;
  }

  /** Absolute progress the next gate sits at. */
  private nextTarget(): number {
    return this.startProgress + (this.checkpointsPassed + 1) * this.spacing;
  }

  update(dt: number, progress: number, carsAhead: number): void {
    if (this.state === 'countdown') {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const now = Math.ceil(this.countdown);
      if (now !== before) this.onCountdown?.(Math.max(0, now));
      if (this.countdown <= 0) {
        this.state = 'running';
        this.countdown = 0;
      }
      return;
    }

    if (this.state !== 'running') return;

    this.time += dt;
    this.position = 1 + carsAhead;

    // Checkpoints (only forward progress counts).
    while (progress >= this.nextTarget()) {
      this.checkpointsPassed++;
      this.checkpointIndex = this.checkpointsPassed % TRACK.checkpointCount;
      this.onCheckpoint?.(this.checkpointsPassed, this.totalCheckpoints);

      if (this.checkpointsPassed % TRACK.checkpointCount === 0) {
        if (this.lap >= TRACK.laps) {
          this.state = 'finished';
          this.onFinish?.({
            time: this.time,
            position: this.position,
            laps: this.lap,
            checkpoints: this.checkpointsPassed,
          });
          return;
        }
        this.lap++;
        this.onLap?.(this.lap, TRACK.laps);
      }
    }
  }

  get lapLabel(): string {
    return `${Math.min(this.lap, TRACK.laps)}/${TRACK.laps}`;
  }

  get checkpointLabel(): string {
    return `${this.checkpointsPassed % TRACK.checkpointCount}/${TRACK.checkpointCount}`;
  }
}
