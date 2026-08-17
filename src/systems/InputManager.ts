import type { VehicleInput } from '../physics/VehiclePhysics';

type Action = 'throttle' | 'brake' | 'left' | 'right' | 'handbrake' | 'nitro';

const KEY_MAP: Record<string, Action> = {
  KeyW: 'throttle',
  ArrowUp: 'throttle',
  KeyS: 'brake',
  ArrowDown: 'brake',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'handbrake',
  ShiftLeft: 'nitro',
  ShiftRight: 'nitro',
};

/**
 * Keyboard + touch input, exposed as a single analog VehicleInput.
 * One-shot keys (camera / reset / pause) are delivered through callbacks so
 * the game never has to poll for edges.
 */
export class InputManager {
  private readonly held: Record<Action, boolean> = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    handbrake: false,
    nitro: false,
  };
  private readonly touch: Record<Action, boolean> = { ...this.held };

  readonly input: VehicleInput = {
    throttle: 0,
    brake: 0,
    steer: 0,
    handbrake: false,
    nitro: false,
  };

  onCameraToggle: (() => void) | null = null;
  onReset: (() => void) | null = null;
  onPause: (() => void) | null = null;
  onAnyKey: (() => void) | null = null;

  enabled = true;

  private readonly keyDown = (e: KeyboardEvent): void => {
    this.onAnyKey?.();
    const action = KEY_MAP[e.code];
    if (action) {
      this.held[action] = true;
      e.preventDefault();
    }
    if (e.repeat) return;
    switch (e.code) {
      case 'KeyC':
        this.onCameraToggle?.();
        break;
      case 'KeyR':
        this.onReset?.();
        break;
      case 'Escape':
        this.onPause?.();
        break;
      default:
        break;
    }
  };

  private readonly keyUp = (e: KeyboardEvent): void => {
    const action = KEY_MAP[e.code];
    if (action) {
      this.held[action] = false;
      e.preventDefault();
    }
  };

  private readonly blur = (): void => {
    (Object.keys(this.held) as Action[]).forEach((k) => {
      this.held[k] = false;
      this.touch[k] = false;
    });
  };

  constructor() {
    window.addEventListener('keydown', this.keyDown, { passive: false });
    window.addEventListener('keyup', this.keyUp, { passive: false });
    window.addEventListener('blur', this.blur);
  }

  /** Wires the on-screen buttons for touch devices. */
  bindTouchControls(container: HTMLElement): void {
    const map: Record<string, Action> = {
      throttle: 'throttle',
      brake: 'brake',
      left: 'left',
      right: 'right',
      handbrake: 'handbrake',
      nitro: 'nitro',
    };
    container.querySelectorAll<HTMLElement>('[data-key]').forEach((btn) => {
      const action = map[btn.dataset.key ?? ''];
      if (!action) return;
      const press = (on: boolean) => (e: Event) => {
        e.preventDefault();
        this.touch[action] = on;
        btn.classList.toggle('pressed', on);
      };
      btn.addEventListener('pointerdown', press(true));
      btn.addEventListener('pointerup', press(false));
      btn.addEventListener('pointerleave', press(false));
      btn.addEventListener('pointercancel', press(false));
    });
  }

  /** Smooths the digital keys into the analog values the physics wants. */
  update(dt: number): VehicleInput {
    const i = this.input;
    if (!this.enabled) {
      i.throttle = 0;
      i.brake = 0;
      i.steer = 0;
      i.handbrake = false;
      i.nitro = false;
      return i;
    }

    const on = (a: Action) => this.held[a] || this.touch[a];
    const ramp = 6 * dt;

    i.throttle = approach(i.throttle, on('throttle') ? 1 : 0, ramp * 1.6);
    i.brake = approach(i.brake, on('brake') ? 1 : 0, ramp * 2.4);

    const steerTarget = (on('right') ? 1 : 0) - (on('left') ? 1 : 0);
    // The physics layer does its own slew; this just removes key chatter.
    i.steer = approach(i.steer, steerTarget, ramp * 3.2);

    i.handbrake = on('handbrake');
    i.nitro = on('nitro');
    return i;
  }

  dispose(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('keyup', this.keyUp);
    window.removeEventListener('blur', this.blur);
  }
}

function approach(current: number, target: number, delta: number): number {
  if (current < target) return Math.min(target, current + delta);
  if (current > target) return Math.max(target, current - delta);
  return target;
}
