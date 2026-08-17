import { Gauge } from './Gauge';
import { MiniMap } from './MiniMap';
import type { Track } from '../environment/Track';
import type { MissionSnapshot } from '../systems/MissionManager';
import { formatTime, ordinal } from '../core/MathUtils';
import type { QualityLevel } from '../game/Config';

export type ScreenName =
  | 'loading'
  | 'menu'
  | 'garage'
  | 'settings'
  | 'game'
  | 'pause'
  | 'results';

export type UiAction =
  | 'start'
  | 'garage'
  | 'settings'
  | 'exit'
  | 'garage-back'
  | 'garage-drive'
  | 'settings-back'
  | 'resume'
  | 'restart'
  | 'quit'
  | 'pause-settings';

export interface HudData {
  speedKmh: number;
  rpm: number;
  gear: number;
  nitro: number;
  nitroActive: boolean;
  score: number;
  distanceKm: number;
  position: number;
  lapLabel: string;
  checkpointLabel: string;
  time: number;
  mission: MissionSnapshot;
  player: { x: number; z: number; heading: number };
  npcs: Array<[number, number]>;
  nextCheckpoint: { x: number; z: number } | null;
}

export const PAINT_COLORS: Array<{ name: string; hex: number }> = [
  { name: 'Midnight Black', hex: 0x05060a },
  { name: 'Rosewood Red', hex: 0x7d1220 },
  { name: 'Boulder Grey', hex: 0x4a4f57 },
  { name: 'Everest White', hex: 0xe8e8e6 },
  { name: 'Seiran Blue', hex: 0x12365f },
  { name: 'Ikazuchi Yellow', hex: 0xd8a516 },
];

/**
 * All DOM-side presentation: screen routing, the HUD, toasts and the settings
 * and garage panels. The game core talks to this through plain data, so the
 * renderer never has to know about the DOM.
 */
export class UIManager {
  private readonly screens: Record<string, HTMLElement>;
  private readonly hudEl: HTMLElement;
  private readonly gauge: Gauge;
  private readonly miniMap: MiniMap | null;

  private readonly el = {
    speed: document.getElementById('hud-speed')!,
    gear: document.getElementById('hud-gear')!,
    score: document.getElementById('hud-score')!,
    distance: document.getElementById('hud-distance')!,
    position: document.getElementById('hud-position')!,
    lap: document.getElementById('hud-lap')!,
    time: document.getElementById('hud-time')!,
    checkpoint: document.getElementById('hud-checkpoint')!,
    nitroFill: document.getElementById('nitro-fill')!,
    nitroBar: document.querySelector('.nitro-bar')!,
    missionId: document.getElementById('mission-id')!,
    missionName: document.getElementById('mission-name')!,
    missionState: document.getElementById('mission-state')!,
    missionFill: document.getElementById('mission-fill')!,
    missionProgress: document.getElementById('mission-progress')!,
    bigMessage: document.getElementById('big-message')!,
    toastStack: document.getElementById('toast-stack')!,
    loaderFill: document.getElementById('loader-fill')!,
    loaderText: document.getElementById('loader-text')!,
    fps: document.getElementById('fps-meter')!,
    touch: document.getElementById('touch-controls')!,
  };

  onAction: ((action: UiAction) => void) | null = null;
  onQualityChange: ((q: QualityLevel) => void) | null = null;
  onVolumeChange: ((v: number) => void) | null = null;
  onMusicToggle: ((on: boolean) => void) | null = null;
  onShadowToggle: ((on: boolean) => void) | null = null;
  onTouchModeChange: ((mode: 'on' | 'off' | 'auto') => void) | null = null;
  onPaintChange: ((hex: number) => void) | null = null;
  onGarageView: ((view: string) => void) | null = null;

  private bigMessageTimer = 0;
  private current: ScreenName = 'loading';

  constructor(track: Track | null) {
    this.screens = {
      loading: document.getElementById('loading-screen')!,
      menu: document.getElementById('main-menu')!,
      garage: document.getElementById('garage-screen')!,
      settings: document.getElementById('settings-screen')!,
      pause: document.getElementById('pause-screen')!,
      results: document.getElementById('results-screen')!,
    };
    this.hudEl = document.getElementById('hud')!;

    this.gauge = new Gauge(document.getElementById('rpm-gauge') as HTMLCanvasElement);
    const mapCanvas = document.getElementById('minimap') as HTMLCanvasElement | null;
    this.miniMap = track && mapCanvas ? new MiniMap(mapCanvas, track) : null;

    this.bindButtons();
    this.bindSettings();
    this.bindGarage();
  }

  /* ---------------- wiring ---------------- */

  private bindButtons(): void {
    document.querySelectorAll<HTMLElement>('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action as UiAction;
        this.onAction?.(action);
      });
    });
  }

  private bindSettings(): void {
    const quality = document.getElementById('set-quality')!;
    quality.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        quality.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.onQualityChange?.(chip.dataset.q as QualityLevel);
      });
    });

    const volume = document.getElementById('set-volume') as HTMLInputElement;
    const volumeVal = document.getElementById('set-volume-val')!;
    volume.addEventListener('input', () => {
      volumeVal.textContent = volume.value;
      this.onVolumeChange?.(Number(volume.value) / 100);
    });

    const music = document.getElementById('set-music')!;
    music.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        music.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.onMusicToggle?.(chip.dataset.m === 'on');
      });
    });

    const shadows = document.getElementById('set-shadows')!;
    shadows.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        shadows.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.onShadowToggle?.(chip.dataset.s === 'on');
      });
    });

    const touch = document.getElementById('set-touch')!;
    touch.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        touch.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.onTouchModeChange?.(chip.dataset.t as 'on' | 'off' | 'auto');
      });
    });
  }

  private bindGarage(): void {
    const views = document.getElementById('garage-views')!;
    views.querySelectorAll<HTMLElement>('.chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        views.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        this.onGarageView?.(chip.dataset.view ?? 'front');
      });
    });

    const colors = document.getElementById('garage-colors')!;
    PAINT_COLORS.forEach((paint, i) => {
      const btn = document.createElement('button');
      btn.className = `chip sw${i === 0 ? ' active' : ''}`;
      btn.style.background = `#${paint.hex.toString(16).padStart(6, '0')}`;
      btn.title = paint.name;
      btn.addEventListener('click', () => {
        colors.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
        btn.classList.add('active');
        this.onPaintChange?.(paint.hex);
      });
      colors.appendChild(btn);
    });
  }

  /* ---------------- screens ---------------- */

  setScreen(name: ScreenName): void {
    this.current = name;
    Object.entries(this.screens).forEach(([key, el]) => {
      el.classList.toggle('active', key === name);
    });
    const inGame = name === 'game' || name === 'pause' || name === 'results';
    this.hudEl.classList.toggle('active', inGame);
    this.el.fps.classList.toggle('active', inGame);
    if (name === 'pause' || name === 'results') {
      this.screens[name].classList.add('active');
    }
  }

  get screen(): ScreenName {
    return this.current;
  }

  setLoading(ratio: number, label: string): void {
    (this.el.loaderFill as HTMLElement).style.width = `${Math.round(ratio * 100)}%`;
    this.el.loaderText.textContent = label;
  }

  setTouchVisible(visible: boolean): void {
    this.el.touch.classList.toggle('active', visible);
  }

  get touchContainer(): HTMLElement {
    return this.el.touch;
  }

  /* ---------------- HUD ---------------- */

  updateHud(d: HudData): void {
    this.el.speed.textContent = String(Math.round(d.speedKmh));
    this.el.gear.textContent = d.gear < 0 ? 'R' : d.gear === 0 && d.speedKmh < 1 ? 'N' : String(d.gear + 1);
    this.el.score.textContent = d.score.toLocaleString('en-US');
    this.el.distance.textContent = `${d.distanceKm.toFixed(2)} KM`;
    this.el.position.innerHTML = `${d.position}<sup>${ordinal(d.position).replace(String(d.position), '')}</sup>`;
    this.el.lap.textContent = d.lapLabel;
    this.el.time.textContent = formatTime(d.time);
    this.el.checkpoint.textContent = d.checkpointLabel;

    const nitroPct = Math.max(0, Math.min(100, d.nitro));
    (this.el.nitroFill as HTMLElement).style.width = `${nitroPct}%`;
    (this.el.nitroBar as HTMLElement).classList.toggle('low', nitroPct < 25);

    this.el.missionId.textContent = `MISSION ${String(d.mission.index + 1).padStart(2, '0')}`;
    this.el.missionName.textContent = d.mission.title;
    this.el.missionState.textContent = d.mission.complete ? 'DONE' : 'ACTIVE';
    (this.el.missionFill as HTMLElement).style.width = `${Math.round(d.mission.ratio * 100)}%`;
    this.el.missionProgress.textContent = d.mission.label;

    this.gauge.draw(d.rpm, d.speedKmh, d.nitro, d.nitroActive);
    this.miniMap?.draw(d.player.x, d.player.z, d.player.heading, d.npcs, d.nextCheckpoint);
  }

  setFps(fps: number): void {
    this.el.fps.textContent = `${Math.round(fps)} FPS`;
  }

  /* ---------------- messaging ---------------- */

  bigMessage(text: string, duration = 1.2): void {
    this.el.bigMessage.textContent = text;
    this.el.bigMessage.classList.add('show');
    this.bigMessageTimer = duration;
  }

  toast(text: string, tone: 'good' | 'warn' | 'neutral' = 'neutral'): void {
    const div = document.createElement('div');
    div.className = `toast${tone === 'good' ? ' good' : tone === 'warn' ? ' warn' : ''}`;
    div.textContent = text;
    this.el.toastStack.appendChild(div);
    // Keep the stack short so it never covers the road.
    while (this.el.toastStack.children.length > 4) {
      this.el.toastStack.removeChild(this.el.toastStack.firstChild!);
    }
    window.setTimeout(() => {
      div.classList.add('fade');
      window.setTimeout(() => div.remove(), 420);
    }, 1500);
  }

  tick(dt: number): void {
    if (this.bigMessageTimer > 0) {
      this.bigMessageTimer -= dt;
      if (this.bigMessageTimer <= 0) this.el.bigMessage.classList.remove('show');
    }
  }

  /* ---------------- results ---------------- */

  showResults(data: {
    title: string;
    time: number;
    position: number;
    score: number;
    topSpeed: number;
    distanceKm: number;
    overtakes: number;
  }): void {
    document.getElementById('results-title')!.textContent = data.title;
    document.getElementById('res-time')!.textContent = formatTime(data.time);
    document.getElementById('res-position')!.textContent = ordinal(data.position);
    document.getElementById('res-score')!.textContent = data.score.toLocaleString('en-US');
    document.getElementById('res-topspeed')!.textContent = `${Math.round(data.topSpeed)} KM/H`;
    document.getElementById('res-distance')!.textContent = `${data.distanceKm.toFixed(2)} KM`;
    document.getElementById('res-overtakes')!.textContent = String(data.overtakes);
    this.setScreen('results');
  }
}
