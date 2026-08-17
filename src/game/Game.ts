import * as THREE from 'three';
import { GameRenderer } from './Renderer';
import { QUALITY_PRESETS, TRACK, VEHICLE, type QualityLevel } from './Config';
import { Track } from '../environment/Track';
import { World } from '../environment/World';
import { Vehicle } from '../vehicles/Vehicle';
import { TrafficManager } from '../vehicles/TrafficManager';
import { AssetLoader } from '../core/AssetLoader';
import { InputManager } from '../systems/InputManager';
import { CameraManager } from '../systems/CameraManager';
import { RaceManager } from '../systems/RaceManager';
import { MissionManager } from '../systems/MissionManager';
import { ScoreManager } from '../systems/ScoreManager';
import { AudioManager } from '../audio/AudioManager';
import { PAINT_COLORS, UIManager, type UiAction } from '../ui/UIManager';
import { clamp } from '../core/MathUtils';

type Mode = 'loading' | 'menu' | 'garage' | 'settings' | 'racing' | 'paused' | 'results';

const FIXED_STEP = 1 / 120;
const MAX_STEPS = 5;

/**
 * Application core: owns the scene graph, the systems and the state machine
 * that moves between the menu, the garage and the race.
 */
export class Game {
  private readonly renderer: GameRenderer;
  private readonly track: Track;
  private readonly world: World;
  private readonly ui: UIManager;
  private readonly input = new InputManager();
  private readonly cameras: CameraManager;
  private readonly race: RaceManager;
  private readonly missions = new MissionManager();
  private readonly score = new ScoreManager();
  private readonly audio = new AudioManager();
  private readonly traffic: TrafficManager;

  private vehicle!: Vehicle;
  private mode: Mode = 'loading';
  private previousMode: Mode = 'menu';

  private quality: QualityLevel = 'medium';
  private touchMode: 'on' | 'off' | 'auto' = 'auto';
  private paint = PAINT_COLORS[0].hex;

  private clock = new THREE.Clock();
  private accumulator = 0;
  private orbitAngle = 0;
  private progress = 0;
  private lastTrackDistance = 0;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private garageView = 'front';
  private garageLights: THREE.Group | null = null;
  private raceStarted = false;
  private readonly tmpVec = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.quality = detectQuality();

    this.track = new Track();
    this.renderer = new GameRenderer(canvas, QUALITY_PRESETS[this.quality]);
    this.world = new World(this.track, QUALITY_PRESETS[this.quality]);
    this.cameras = new CameraManager(window.innerWidth / window.innerHeight);
    this.race = new RaceManager(this.track);
    this.traffic = new TrafficManager(this.track);
    this.ui = new UIManager(this.track);

    this.world.scene.add(this.traffic.group);
    this.renderer.applyEnvironment(this.world.scene);
  }

  /* ================================================================ */
  /* boot                                                             */
  /* ================================================================ */

  async init(): Promise<void> {
    this.ui.setScreen('loading');
    this.ui.setLoading(0.05, 'BUILDING WORLD…');

    const loader = new AssetLoader();
    loader.onProgress = (r, label) => this.ui.setLoading(0.1 + r * 0.5, label);
    const model = await loader.loadCarModel();

    this.ui.setLoading(0.7, 'ASSEMBLING NISSAN Z…');
    this.vehicle = new Vehicle(this.track, this.world.collisions, model, this.paint);
    this.world.scene.add(this.vehicle.object);
    this.world.scene.add(this.vehicle.smokeObject);
    this.vehicle.placeOnTrack(0, 2.5);
    this.lastTrackDistance = this.vehicle.projection.distance;

    this.ui.setLoading(0.85, 'WARMING UP SHADERS…');
    this.renderer.setupPasses(this.world.scene, this.cameras.camera);
    // Compiling before the first frame avoids the classic one-second freeze.
    this.renderer.renderer.compile(this.world.scene, this.cameras.camera);

    this.bindEvents();
    this.applyTouchMode();

    this.ui.setLoading(1, 'READY');
    window.setTimeout(() => this.enterMenu(), 350);

    this.clock.start();
    this.loop();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => {
      this.renderer.resize();
      this.cameras.resize(window.innerWidth / window.innerHeight);
      this.applyTouchMode();
    });

    this.input.onCameraToggle = () => {
      if (this.mode !== 'racing') return;
      this.cameras.cycle();
      this.ui.toast(this.cameras.label, 'neutral');
      this.audio.playBeep(660, 0.08, 0.08);
    };
    this.input.onReset = () => {
      if (this.mode !== 'racing') return;
      this.vehicle.respawn();
      this.score.add(-50, 'RESET -50', 'warn');
      this.ui.toast('CAR RESET', 'warn');
    };
    this.input.onPause = () => {
      if (this.mode === 'racing') this.pause();
      else if (this.mode === 'paused') this.resume();
    };

    this.ui.onAction = (action) => this.handleAction(action);
    this.ui.onQualityChange = (q) => this.setQuality(q);
    this.ui.onVolumeChange = (v) => this.audio.setVolume(v);
    this.ui.onMusicToggle = (on) => this.audio.setMusicEnabled(on);
    this.ui.onShadowToggle = (on) => {
      this.renderer.setShadows(on);
      this.world.sun.castShadow = on;
    };
    this.ui.onTouchModeChange = (m) => {
      this.touchMode = m;
      this.applyTouchMode();
    };
    this.ui.onPaintChange = (hex) => {
      this.paint = hex;
      this.vehicle.setPaint(hex);
    };
    this.ui.onGarageView = (view) => {
      this.garageView = view;
    };

    this.race.onCountdown = (n) => {
      if (n > 0) {
        this.ui.bigMessage(String(n), 0.9);
        this.audio.playBeep(520, 0.16, 0.14);
      } else {
        this.ui.bigMessage('GO!', 1.0);
        this.audio.playBeep(980, 0.35, 0.18);
        this.raceStarted = true;
        this.traffic.frozen = false;
      }
    };
    this.race.onCheckpoint = (passed) => {
      this.score.checkpoint();
      this.world.setActiveCheckpoint(this.race.checkpointIndex);
      this.audio.playBeep(1180, 0.1, 0.12);
    };
    this.race.onLap = (lap, total) => {
      this.score.lap();
      this.ui.bigMessage(`LAP ${lap} / ${total}`, 1.6);
      this.audio.playBeep(720, 0.3, 0.16);
    };
    this.race.onFinish = (result) => this.finishRace(result);

    this.missions.onComplete = (m) => {
      this.score.add(m.reward, `MISSION COMPLETE +${m.reward}`, 'good');
      this.ui.bigMessage('MISSION COMPLETE', 1.6);
      this.audio.playBeep(880, 0.25, 0.15);
    };

    this.traffic.onOvertake = () => {
      this.score.overtake();
      this.ui.toast('OVERTAKE', 'good');
    };
    this.traffic.onPlayerHit = (impact) => this.handleImpact(impact, 'traffic');

    this.input.bindTouchControls(this.ui.touchContainer);
  }

  /* ================================================================ */
  /* state machine                                                    */
  /* ================================================================ */

  private handleAction(action: UiAction): void {
    void this.audio.start();
    this.audio.playBeep(520, 0.06, 0.08);

    switch (action) {
      case 'start':
        this.startRace();
        break;
      case 'garage':
        this.enterGarage();
        break;
      case 'settings':
        this.previousMode = this.mode;
        this.mode = 'settings';
        this.ui.setScreen('settings');
        break;
      case 'pause-settings':
        this.previousMode = 'paused';
        this.mode = 'settings';
        this.ui.setScreen('settings');
        break;
      case 'settings-back':
        if (this.previousMode === 'paused') {
          this.mode = 'paused';
          this.ui.setScreen('pause');
        } else {
          this.enterMenu();
        }
        break;
      case 'garage-back':
        this.enterMenu();
        break;
      case 'garage-drive':
        this.startRace();
        break;
      case 'exit':
        this.exit();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.startRace();
        break;
      case 'quit':
        this.enterMenu();
        break;
      default:
        break;
    }
  }

  private enterMenu(): void {
    this.mode = 'menu';
    this.ui.setScreen('menu');
    this.input.enabled = false;
    this.audio.setEngineMuted(true);
    this.teardownGarageLights();
    this.vehicle.placeOnTrack(0, 2.5);
    this.cameras.setMode('third');
  }

  private enterGarage(): void {
    this.mode = 'garage';
    this.ui.setScreen('garage');
    this.input.enabled = false;
    this.vehicle.placeOnTrack(0, 0);
    this.setupGarageLights();
  }

  private startRace(): void {
    this.mode = 'racing';
    this.ui.setScreen('game');
    this.teardownGarageLights();

    this.vehicle.placeOnTrack(0, 2.5);
    this.vehicle.odometer = 0;
    this.vehicle.topSpeed = 0;
    this.progress = 0;
    this.lastTrackDistance = this.vehicle.projection.distance;
    this.raceStarted = false;

    this.traffic.reset(this.vehicle.projection.distance);
    this.traffic.frozen = true;
    this.missions.reset();
    this.score.reset();
    this.race.begin(0);
    this.world.setActiveCheckpoint(1 % TRACK.checkpointCount);

    this.cameras.setMode('third');
    this.input.enabled = true;
    this.audio.setEngineMuted(false);
    void this.audio.start();
    this.ui.bigMessage('GET READY', 1.0);
  }

  private pause(): void {
    if (this.mode !== 'racing') return;
    this.mode = 'paused';
    this.ui.setScreen('pause');
    this.input.enabled = false;
    this.audio.setEngineMuted(true);
  }

  private resume(): void {
    if (this.mode !== 'paused') return;
    this.mode = 'racing';
    this.ui.setScreen('game');
    this.input.enabled = true;
    this.audio.setEngineMuted(false);
    this.clock.getDelta(); // discard the paused time
  }

  private finishRace(result: { time: number; position: number }): void {
    this.mode = 'results';
    this.input.enabled = false;
    this.audio.setEngineMuted(true);
    this.score.add(5000, 'RACE COMPLETE +5000', 'good');

    // The loop stops here, so the "Complete the Race" objective is credited
    // explicitly rather than waiting for the next telemetry tick.
    this.missions.update(0, {
      speedKmh: this.vehicle.speedKmh,
      distance: this.vehicle.odometer,
      overtakes: this.traffic.overtakes,
      drifting: false,
      raceFinished: true,
    });
    this.ui.showResults({
      title: result.position === 1 ? 'VICTORY' : 'RACE COMPLETE',
      time: result.time,
      position: result.position,
      score: this.score.score,
      topSpeed: this.vehicle.topSpeed,
      distanceKm: this.vehicle.odometer / 1000,
      overtakes: this.traffic.overtakes,
    });
  }

  private exit(): void {
    this.input.enabled = false;
    this.audio.setEngineMuted(true);
    // Browsers block window.close() for pages they did not open, so treat
    // EXIT as "engine off": back to the menu with the audio suspended.
    window.close();
    this.audio.suspend();
    this.enterMenu();
  }

  /* ================================================================ */
  /* garage presentation                                              */
  /* ================================================================ */

  private setupGarageLights(): void {
    if (this.garageLights) return;
    const g = new THREE.Group();
    const positions: Array<[number, number, number, number]> = [
      [6, 5, 6, 0xffffff],
      [-7, 4, 3, 0x9fc4ff],
      [0, 5, -8, 0xffc38a],
    ];
    positions.forEach(([x, y, z, color]) => {
      const light = new THREE.SpotLight(color, 260, 40, 0.7, 0.6, 2);
      light.position.set(x, y, z);
      g.add(light);
      g.add(light.target);
    });
    g.position.copy(this.vehicle.object.position);
    this.world.scene.add(g);
    this.garageLights = g;
  }

  private teardownGarageLights(): void {
    if (!this.garageLights) return;
    this.world.scene.remove(this.garageLights);
    this.garageLights.traverse((obj) => {
      const light = obj as THREE.SpotLight;
      if (light.isSpotLight) light.dispose();
    });
    this.garageLights = null;
  }

  private updateGarageCamera(dt: number): void {
    const car = this.vehicle.object;
    const yaw = car.rotation.y;
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const p = this.tmpVec;

    switch (this.garageView) {
      case 'side':
        p.set(car.position.x + cos * 6.6, car.position.y + 1.3, car.position.z - sin * 6.6);
        break;
      case 'rear':
        p.set(car.position.x - sin * 6.4, car.position.y + 1.8, car.position.z - cos * 6.4);
        break;
      case 'interior':
        this.vehicle.getCockpitPosition(p);
        p.y += 0.06;
        break;
      default:
        p.set(car.position.x + sin * 6.6, car.position.y + 1.6, car.position.z + cos * 6.6);
        break;
    }

    this.cameras.camera.position.lerp(p, 1 - Math.exp(-6 * dt));
    if (this.garageView === 'interior') {
      this.cameras.camera.lookAt(
        car.position.x + sin * 8,
        car.position.y + 1.0,
        car.position.z + cos * 8,
      );
    } else {
      this.cameras.camera.lookAt(car.position.x, car.position.y + 0.75, car.position.z);
    }
  }

  /* ================================================================ */
  /* loop                                                             */
  /* ================================================================ */

  private loop = (): void => {
    requestAnimationFrame(this.loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.1);

    this.fpsAccum += raw;
    this.fpsFrames++;
    if (this.fpsAccum >= 0.5) {
      this.ui.setFps(this.fpsFrames / this.fpsAccum);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
    }

    switch (this.mode) {
      case 'racing':
        this.updateRacing(dt);
        break;
      case 'menu':
        this.updateMenu(dt);
        break;
      case 'settings':
        // Opened from the pause menu the world stays where it was; from the
        // main menu it keeps the cinematic orbit running behind the panel.
        if (this.previousMode === 'paused') this.cameras.update(dt, this.vehicle);
        else this.updateMenu(dt);
        break;
      case 'garage':
        this.updateGarageCamera(dt);
        this.world.update(dt, this.vehicle.object.position);
        break;
      case 'paused':
      case 'results':
        // Keep the world alive behind the panel, but frozen in place.
        this.cameras.update(dt, this.vehicle);
        break;
      default:
        break;
    }

    this.ui.tick(dt);
    this.renderer.setCamera(this.cameras.camera);
    this.renderer.render(this.world.scene, this.cameras.camera);
  };

  private updateMenu(dt: number): void {
    this.orbitAngle += dt * 0.12;
    const car = this.vehicle.object.position;
    this.cameras.orbit(car, 8.5, 2.4, this.orbitAngle, 0.9);
    this.world.update(dt, car);
    this.traffic.update(dt, this.vehicle, this.progress);
  }

  private updateRacing(dt: number): void {
    const input = this.input.update(dt);

    // Hold the car on the line until the lights go out. The handbrake (rather
    // than the brake pedal) is what keeps it still, because S at a standstill
    // is the reverse-gear request.
    if (!this.raceStarted) {
      input.throttle = 0;
      input.brake = 0;
      input.steer = 0;
      input.nitro = false;
      input.handbrake = true;
    }

    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_STEP && steps < MAX_STEPS) {
      this.vehicle.update(FIXED_STEP, input);
      this.accumulator -= FIXED_STEP;
      steps++;
    }
    if (steps === MAX_STEPS) this.accumulator = 0;

    /* ---- progress along the racing line ---- */
    const dist = this.vehicle.projection.distance;
    const delta = this.track.deltaDistance(dist, this.lastTrackDistance);
    if (Math.abs(delta) < 150) this.progress += delta;
    this.lastTrackDistance = dist;

    this.traffic.update(dt, this.vehicle, this.progress);
    this.race.update(dt, this.progress, this.traffic.countAhead(this.progress));
    this.world.update(dt, this.vehicle.object.position);
    this.cameras.update(dt, this.vehicle);

    /* ---- collisions ---- */
    const hit = this.vehicle.consumeCollision();
    if (hit) this.handleImpact(hit.impact, hit.kind);

    /* ---- scoring + missions ---- */
    const s = this.vehicle.physics.state;
    const speedKmh = this.vehicle.speedKmh;
    this.score.update(dt, {
      drifting: s.drifting,
      speedKmh,
      nitroActive: s.nitroActive,
    });
    // Rewards are credited by the onComplete hook, so the return value is
    // only interesting for debugging.
    this.missions.update(dt, {
      speedKmh,
      distance: this.vehicle.odometer,
      overtakes: this.traffic.overtakes,
      drifting: s.drifting,
      raceFinished: this.race.state === 'finished',
    });

    this.score.drainEvents().forEach((e) => this.ui.toast(e.label, e.tone));

    /* ---- audio ---- */
    this.audio.update(dt, {
      rpm: s.rpm,
      throttle: input.throttle,
      speed: Math.abs(s.vLong),
      maxSpeed: VEHICLE.maxSpeed,
      drift: clamp(s.driftAngle * 3, 0, 1),
      offRoad: this.vehicle.offRoad,
      nitro: s.nitroActive,
      braking: input.brake > 0.2,
    });

    /* ---- speed effect ---- */
    const speedT = clamp(Math.abs(s.vLong) / VEHICLE.maxSpeed, 0, 1);
    this.renderer.setSpeedBlur(Math.max(0, speedT - 0.45) * 1.4 + (s.nitroActive ? 0.55 : 0), dt);

    this.pushHud();
  }

  private handleImpact(impact: number, kind: string): void {
    this.audio.playCollision(impact);
    this.cameras.addShake(clamp(impact / 18, 0.1, 1));
    this.score.collision(impact);
    if (impact > 12) this.ui.toast(`IMPACT — ${kind.toUpperCase()}`, 'warn');
  }

  private pushHud(): void {
    const s = this.vehicle.physics.state;
    const npcs: Array<[number, number]> = [];
    this.traffic.forEachCar((x, z) => npcs.push([x, z]));

    const cpDistance = this.track.checkpointDistances[this.race.checkpointIndex];
    this.track.positionAt(cpDistance, 0, this.tmpVec);

    this.ui.updateHud({
      speedKmh: this.vehicle.speedKmh,
      rpm: s.rpm,
      gear: s.gear,
      nitro: s.nitro,
      nitroActive: s.nitroActive,
      score: this.score.score,
      distanceKm: this.vehicle.odometer / 1000,
      position: this.race.position,
      lapLabel: this.race.lapLabel,
      checkpointLabel: this.race.checkpointLabel,
      time: this.race.time,
      mission: this.missions.current(),
      player: { x: s.x, z: s.z, heading: s.yaw },
      npcs,
      nextCheckpoint: { x: this.tmpVec.x, z: this.tmpVec.z },
    });
  }

  /* ================================================================ */
  /* settings                                                         */
  /* ================================================================ */

  private setQuality(q: QualityLevel): void {
    this.quality = q;
    const preset = QUALITY_PRESETS[q];
    this.renderer.setQuality(preset, this.world.scene, this.cameras.camera);
    this.world.sun.castShadow = preset.shadows;
    this.world.sun.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    if (this.world.scene.fog instanceof THREE.Fog) this.world.scene.fog.far = preset.drawDistance;
    this.ui.toast(`QUALITY: ${q.toUpperCase()}`, 'neutral');
  }

  private applyTouchMode(): void {
    const coarse =
      window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window;
    const visible = this.touchMode === 'on' || (this.touchMode === 'auto' && coarse);
    this.ui.setTouchVisible(visible);
  }
}

/** Picks a sensible starting quality from the device's hardware hints. */
function detectQuality(): QualityLevel {
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || cores <= 4) return 'low';
  if (cores >= 12) return 'high';
  return 'medium';
}
