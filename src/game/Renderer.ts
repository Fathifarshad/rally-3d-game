import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { QualitySettings } from './Config';
import { clamp, damp } from '../core/MathUtils';

/** Radial blur used for the nitro/speed effect. */
const SpeedBlurShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    strength: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - vec2(0.5);
      vec4 sum = vec4(0.0);
      for (int i = 0; i < 8; i++) {
        float t = float(i) / 7.0;
        sum += texture2D(tDiffuse, vUv - dir * t * strength);
      }
      gl_FragColor = sum / 8.0;
    }
  `,
};

/**
 * Owns the WebGL renderer, the PBR environment map and the post chain
 * (bloom + radial speed blur). Quality changes rebuild only what they must.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private speedPass: ShaderPass | null = null;
  private renderPass: RenderPass | null = null;
  private pmrem: THREE.PMREMGenerator;
  private envTexture: THREE.Texture | null = null;
  private quality: QualitySettings;
  private blurStrength = 0;

  constructor(canvas: HTMLCanvasElement, quality: QualitySettings) {
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: quality.pixelRatioCap <= 1.5,
      powerPreference: 'high-performance',
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.shadowMap.enabled = quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /**
   * Bakes the reflection probe the PBR materials use.
   *
   * It is captured from the game world itself (sky, ground, distant city), not
   * from a studio box: a studio environment puts big white area lights in the
   * car's flanks, which turns glossy black paint into white panels. Sampling
   * the real sky gives the correct automotive look — blue gradient across the
   * top surfaces, dark ground reflected in the sides.
   *
   * Must be called after the world is built and before the car is added, so
   * the car cannot end up reflected in itself.
   */
  applyEnvironment(scene: THREE.Scene): void {
    if (!this.envTexture) {
      const fog = scene.fog;
      scene.fog = null;
      this.envTexture = this.pmrem.fromScene(scene, 0.05, 2, 4000).texture;
      scene.fog = fog;
    }
    scene.environment = this.envTexture;
    scene.environmentIntensity = 0.8;
  }

  setupPasses(scene: THREE.Scene, camera: THREE.Camera): void {
    this.composer?.dispose();
    const composer = new EffectComposer(this.renderer);
    composer.setPixelRatio(Math.min(window.devicePixelRatio, this.quality.pixelRatioCap));
    composer.setSize(window.innerWidth, window.innerHeight);

    this.renderPass = new RenderPass(scene, camera);
    composer.addPass(this.renderPass);

    if (this.quality.bloom) {
      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.42,
        0.75,
        0.86,
      );
      composer.addPass(this.bloomPass);
    } else {
      this.bloomPass = null;
    }

    this.speedPass = new ShaderPass(SpeedBlurShader);
    this.speedPass.enabled = false;
    composer.addPass(this.speedPass);

    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  setCamera(camera: THREE.Camera): void {
    if (this.renderPass) this.renderPass.camera = camera;
  }

  /**
   * @param intensity 0..1 — driven by speed and nitro.
   */
  setSpeedBlur(intensity: number, dt: number): void {
    this.blurStrength = damp(this.blurStrength, clamp(intensity, 0, 1) * 0.16, 6, dt);
    if (this.speedPass) {
      this.speedPass.enabled = this.blurStrength > 0.004;
      this.speedPass.uniforms.strength.value = this.blurStrength;
    }
  }

  render(scene: THREE.Scene, camera: THREE.Camera): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(scene, camera);
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloomPass?.setSize(w, h);
  }

  setQuality(quality: QualitySettings, scene: THREE.Scene, camera: THREE.Camera): void {
    this.quality = quality;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality.pixelRatioCap));
    this.renderer.shadowMap.enabled = quality.shadows;
    this.setupPasses(scene, camera);
  }

  setShadows(enabled: boolean): void {
    this.renderer.shadowMap.enabled = enabled;
    this.renderer.shadowMap.needsUpdate = true;
  }

  get info(): THREE.WebGLInfo {
    return this.renderer.info;
  }

  dispose(): void {
    this.composer?.dispose();
    this.pmrem.dispose();
    this.envTexture?.dispose();
    this.renderer.dispose();
  }
}
