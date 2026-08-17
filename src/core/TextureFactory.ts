import * as THREE from 'three';

/**
 * All textures are generated procedurally on a 2D canvas at boot. This keeps
 * the repository asset-free while still giving PBR materials something to
 * work with; every texture is created once and cached for reuse so we never
 * pay for duplicate GPU uploads.
 */

const cache = new Map<string, THREE.Texture>();

function makeCanvas(size: number, h = size): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context unavailable');
  return ctx;
}

function finish(
  ctx: CanvasRenderingContext2D,
  key: string,
  repeat: [number, number] = [1, 1],
  srgb = true,
): THREE.Texture {
  const tex = new THREE.CanvasTexture(ctx.canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

function noise(ctx: CanvasRenderingContext2D, amount: number, alpha: number): void {
  const { width, height } = ctx.canvas;
  const img = ctx.getImageData(0, 0, width, height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    d[i] = Math.min(255, Math.max(0, d[i] + n));
    d[i + 1] = Math.min(255, Math.max(0, d[i + 1] + n));
    d[i + 2] = Math.min(255, Math.max(0, d[i + 2] + n));
    d[i + 3] = Math.min(255, d[i + 3] * alpha + 255 * (1 - alpha));
  }
  ctx.putImageData(img, 0, 0);
}

/**
 * The full road cross-section in a single tile: U spans the tarmac width
 * (edge lines, lane dashes and the double yellow centre), V repeats every
 * 14 m along the track so the dashes come for free from the wrap mode.
 */
export function roadTexture(): THREE.Texture {
  const key = 'road';
  const cached = cache.get(key);
  if (cached) return cached;

  const S = 1024;
  const ctx = makeCanvas(S);
  ctx.fillStyle = '#26272b';
  ctx.fillRect(0, 0, S, S);

  // Coarse asphalt blotches.
  for (let i = 0; i < 2600; i++) {
    const r = 2 + Math.random() * 9;
    const g = 26 + Math.random() * 26;
    ctx.fillStyle = `rgba(${g},${g + 1},${g + 4},${0.06 + Math.random() * 0.25})`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Faint tyre-worn lanes.
  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  [0.14, 0.36, 0.64, 0.86].forEach((u) => ctx.fillRect(u * S - 34, 0, 68, S));

  const white = '#e9e9e4';
  const yellow = '#e5b93c';

  // Solid edge lines.
  ctx.fillStyle = white;
  ctx.fillRect(6, 0, 12, S);
  ctx.fillRect(S - 18, 0, 12, S);

  // Dashed lane separators at 1/4 and 3/4.
  const dashLen = S * 0.46;
  [0.25, 0.75].forEach((u) => {
    ctx.fillRect(u * S - 5, 0, 10, dashLen);
  });

  // Double yellow centre line.
  ctx.fillStyle = yellow;
  ctx.fillRect(S * 0.5 - 13, 0, 9, S);
  ctx.fillRect(S * 0.5 + 4, 0, 9, S);

  noise(ctx, 26, 1);
  return finish(ctx, key, [1, 1]);
}

export function roadRoughnessTexture(): THREE.Texture {
  const key = 'road-rough';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 512;
  const ctx = makeCanvas(S);
  ctx.fillStyle = '#b4b4b4';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 1800; i++) {
    const v = 130 + Math.random() * 90;
    ctx.fillStyle = `rgba(${v},${v},${v},0.4)`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 2 + Math.random() * 7, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(ctx, key, [1, 1], false);
}

/**
 * @param repeat tiling for this instance. Each distinct tiling gets its own
 * cached texture, because a Texture owns its repeat and the terrain and the
 * road verge need very different scales.
 */
export function grassTexture(repeat: [number, number] = [80, 80]): THREE.Texture {
  const key = `grass-${repeat[0]}x${repeat[1]}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 512;
  const ctx = makeCanvas(S);
  ctx.fillStyle = '#3d5730';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4200; i++) {
    const g = 60 + Math.random() * 70;
    ctx.fillStyle = `rgba(${g * 0.6},${g},${g * 0.45},${0.15 + Math.random() * 0.4})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 4, 2 + Math.random() * 6);
  }
  for (let i = 0; i < 220; i++) {
    ctx.fillStyle = `rgba(90,80,50,${0.05 + Math.random() * 0.15})`;
    ctx.beginPath();
    ctx.arc(Math.random() * S, Math.random() * S, 8 + Math.random() * 26, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(ctx, key, repeat);
}

export function buildingTexture(): THREE.Texture {
  const key = 'building';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 512;
  const ctx = makeCanvas(S);
  const base = 30 + Math.random() * 20;
  ctx.fillStyle = `rgb(${base},${base + 3},${base + 8})`;
  ctx.fillRect(0, 0, S, S);
  const cols = 8;
  const rows = 16;
  const w = S / cols;
  const h = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const lit = Math.random() < 0.42;
      const warm = Math.random() < 0.7;
      const c = lit
        ? warm
          ? `rgba(255,210,140,${0.55 + Math.random() * 0.4})`
          : `rgba(180,220,255,${0.4 + Math.random() * 0.4})`
        : `rgba(18,20,26,0.92)`;
      ctx.fillStyle = c;
      ctx.fillRect(x * w + w * 0.16, y * h + h * 0.2, w * 0.68, h * 0.5);
    }
  }
  noise(ctx, 16, 1);
  return finish(ctx, key, [1, 1]);
}

/** Emissive mask so only the windows glow at night-ish exposure. */
export function buildingEmissiveTexture(): THREE.Texture {
  const key = 'building-emissive';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 256;
  const ctx = makeCanvas(S);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  const cols = 8;
  const rows = 16;
  const w = S / cols;
  const h = S / rows;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (Math.random() < 0.34) {
        ctx.fillStyle = `rgba(255,196,120,${0.5 + Math.random() * 0.5})`;
        ctx.fillRect(x * w + w * 0.16, y * h + h * 0.2, w * 0.68, h * 0.5);
      }
    }
  }
  return finish(ctx, key, [1, 1]);
}

export function cloudTexture(): THREE.Texture {
  const key = 'cloud';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 256;
  const ctx = makeCanvas(S);
  ctx.clearRect(0, 0, S, S);
  for (let i = 0; i < 46; i++) {
    const x = S * 0.5 + (Math.random() - 0.5) * S * 0.7;
    const y = S * 0.5 + (Math.random() - 0.5) * S * 0.38;
    const r = 18 + Math.random() * 46;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(ctx, key, [1, 1]);
}

/** Soft round blob used for headlight/taillight glows and tyre smoke. */
export function glowTexture(): THREE.Texture {
  const key = 'glow';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 128;
  const ctx = makeCanvas(S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(ctx, key, [1, 1]);
}

export function smokeTexture(): THREE.Texture {
  const key = 'smoke';
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 128;
  const ctx = makeCanvas(S);
  for (let i = 0; i < 22; i++) {
    const x = S / 2 + (Math.random() - 0.5) * 46;
    const y = S / 2 + (Math.random() - 0.5) * 46;
    const r = 14 + Math.random() * 32;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.30)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  return finish(ctx, key, [1, 1]);
}

export type SignKind = 'speed' | 'curve' | 'exit' | 'checkpoint';

export function signTexture(kind: SignKind): THREE.Texture {
  const key = `sign-${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const S = 256;
  const ctx = makeCanvas(S);
  ctx.clearRect(0, 0, S, S);
  if (kind === 'speed') {
    ctx.fillStyle = '#f2f2ef';
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#c62b2b';
    ctx.lineWidth = 26;
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S * 0.38, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#16181c';
    ctx.font = 'bold 110px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('120', S / 2, S / 2 + 6);
  } else if (kind === 'curve') {
    ctx.fillStyle = '#e8b62c';
    ctx.beginPath();
    ctx.moveTo(S / 2, 12);
    ctx.lineTo(S - 12, S / 2);
    ctx.lineTo(S / 2, S - 12);
    ctx.lineTo(12, S / 2);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(S * 0.36, S * 0.74);
    ctx.quadraticCurveTo(S * 0.72, S * 0.6, S * 0.44, S * 0.3);
    ctx.stroke();
  } else if (kind === 'exit') {
    ctx.fillStyle = '#1d6b3a';
    ctx.fillRect(0, S * 0.18, S, S * 0.64);
    ctx.strokeStyle = '#f2f2ef';
    ctx.lineWidth = 7;
    ctx.strokeRect(12, S * 0.18 + 12, S - 24, S * 0.64 - 24);
    ctx.fillStyle = '#f2f2ef';
    ctx.font = 'bold 56px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CITY', S / 2, S * 0.42);
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('NEXT 2 KM', S / 2, S * 0.63);
  } else {
    ctx.fillStyle = '#0d0f13';
    ctx.fillRect(0, S * 0.2, S, S * 0.6);
    ctx.fillStyle = '#e0243c';
    ctx.fillRect(0, S * 0.2, S, 10);
    ctx.fillRect(0, S * 0.8 - 10, S, 10);
    ctx.fillStyle = '#f2f2ef';
    ctx.font = 'bold 52px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('CHECKPOINT', S / 2, S / 2);
  }
  return finish(ctx, key, [1, 1]);
}

export function disposeTextureCache(): void {
  cache.forEach((t) => t.dispose());
  cache.clear();
}
