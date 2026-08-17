import type { Track } from '../environment/Track';

/**
 * Player-centred, heading-up mini map drawn on a 2D canvas.
 * The track outline is baked once into an offscreen canvas in world units and
 * then blitted with a rotation each frame, so per-frame cost stays tiny.
 */
export class MiniMap {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly path: Array<[number, number]>;
  private readonly size: number;
  private readonly range = 340; // metres visible across the map

  constructor(canvas: HTMLCanvasElement, private readonly track: Track) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('MiniMap needs a 2D context');
    this.ctx = ctx;
    this.size = canvas.width;
    this.path = track.getMiniMapPath(6);
  }

  draw(
    px: number,
    pz: number,
    heading: number,
    npcs: Array<[number, number]>,
    checkpoint: { x: number; z: number } | null,
  ): void {
    const ctx = this.ctx;
    const S = this.size;
    const R = S / 2;
    const scale = S / this.range;

    ctx.clearRect(0, 0, S, S);

    // Frame.
    ctx.save();
    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(8,10,14,0.72)';
    ctx.fill();
    ctx.clip();

    ctx.translate(R, R);
    ctx.rotate(heading);
    ctx.translate(-px * scale, pz * scale);

    // Track ribbon.
    ctx.beginPath();
    for (let i = 0; i < this.path.length; i++) {
      const [x, z] = this.path[i];
      const sx = x * scale;
      const sy = -z * scale;
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.strokeStyle = 'rgba(210,215,225,0.55)';
    ctx.lineWidth = Math.max(3, this.track.halfWidth * 2 * scale);
    ctx.lineJoin = 'round';
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 1;
    ctx.stroke();

    // Traffic.
    ctx.fillStyle = '#e0b23c';
    for (const [x, z] of npcs) {
      ctx.beginPath();
      ctx.arc(x * scale, -z * scale, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    // Next checkpoint.
    if (checkpoint) {
      ctx.fillStyle = '#46d67f';
      ctx.beginPath();
      ctx.arc(checkpoint.x * scale, -checkpoint.z * scale, 5, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    // Player arrow (always centred, pointing up).
    ctx.save();
    ctx.translate(R, R);
    ctx.beginPath();
    ctx.moveTo(0, -9);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 3);
    ctx.lineTo(-6, 7);
    ctx.closePath();
    ctx.fillStyle = '#e0243c';
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(R, R, R - 2, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
