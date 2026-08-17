import { VEHICLE } from '../game/Config';
import { clamp } from '../core/MathUtils';

/**
 * Digital instrument cluster: a sweeping RPM arc with a redline segment and a
 * finer speed arc outside it. Drawn on a 2D canvas that sits under the HTML
 * speed readout, which keeps the crisp type of the DOM and the smooth arcs of
 * canvas in the same widget.
 */
export class Gauge {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private smoothRpm = 0;

  private readonly start = Math.PI * 0.75;
  private readonly sweep = Math.PI * 1.5;

  constructor(canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Gauge needs a 2D context');
    this.ctx = ctx;
    this.size = canvas.width;
  }

  draw(rpm: number, speedKmh: number, nitro: number, boosting: boolean): void {
    const ctx = this.ctx;
    const S = this.size;
    const c = S / 2;
    const r = S * 0.42;

    this.smoothRpm += (rpm - this.smoothRpm) * 0.25;
    const rpmT = clamp(this.smoothRpm / VEHICLE.maxRpm, 0, 1);
    const redline = VEHICLE.shiftUpRpm / VEHICLE.maxRpm;

    ctx.clearRect(0, 0, S, S);

    // Base track.
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(c, c, r, this.start, this.start + this.sweep);
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.lineWidth = S * 0.045;
    ctx.stroke();

    // Redline zone.
    ctx.beginPath();
    ctx.arc(c, c, r, this.start + this.sweep * redline, this.start + this.sweep);
    ctx.strokeStyle = 'rgba(224,36,60,0.28)';
    ctx.lineWidth = S * 0.045;
    ctx.stroke();

    // Live RPM.
    const grad = ctx.createLinearGradient(0, 0, S, S);
    if (boosting) {
      grad.addColorStop(0, '#3fa9ff');
      grad.addColorStop(1, '#9ceaff');
    } else {
      grad.addColorStop(0, '#e0243c');
      grad.addColorStop(0.6, '#ff7a4d');
      grad.addColorStop(1, '#ffd166');
    }
    ctx.beginPath();
    ctx.arc(c, c, r, this.start, this.start + this.sweep * rpmT);
    ctx.strokeStyle = grad;
    ctx.lineWidth = S * 0.045;
    ctx.shadowColor = boosting ? 'rgba(79,216,255,0.7)' : 'rgba(224,36,60,0.6)';
    ctx.shadowBlur = S * 0.06;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Ticks.
    ctx.save();
    ctx.translate(c, c);
    const ticks = 9;
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      const a = this.start + this.sweep * t;
      const inner = r - S * 0.045;
      const outer = inner - (i % 1 === 0 ? S * 0.03 : S * 0.02);
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
      ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      ctx.strokeStyle = t >= redline ? 'rgba(224,36,60,0.85)' : 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.font = `${Math.round(S * 0.038)}px Bahnschrift, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const lr = outer - S * 0.05;
      ctx.fillText(String(i), Math.cos(a) * lr, Math.sin(a) * lr);
    }
    ctx.restore();

    // Outer speed arc.
    const speedT = clamp(speedKmh / 300, 0, 1);
    ctx.beginPath();
    ctx.arc(c, c, r + S * 0.045, this.start, this.start + this.sweep * speedT);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = S * 0.012;
    ctx.stroke();

    // Nitro arc at the very edge.
    ctx.beginPath();
    ctx.arc(c, c, r + S * 0.075, this.start, this.start + this.sweep * clamp(nitro / 100, 0, 1));
    ctx.strokeStyle = boosting ? 'rgba(79,216,255,0.95)' : 'rgba(79,216,255,0.5)';
    ctx.lineWidth = S * 0.012;
    ctx.stroke();
  }
}
