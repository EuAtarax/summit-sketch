import type { PanoramaScene, Ridgeline } from '../../horizon/scene';
import { rayEnvelope, raysPerVertex } from '../envelope';
import { drawPeakLabels, LABEL_FONT_FAMILY, type LabelStyle } from '../labels';
import type { PanoramaStyle } from '../style';
import { gridStep, wrap180 } from '../viewTransform';

const PAPER = '#F4F6F7';
const SEA = '#9FC3D6';
const HORIZON = '#C8102E';
const NEAR = [31, 42, 51] as const; // slate ink
const FAR = [168, 196, 207] as const; // pale glacier

const LABEL_STYLE: LabelStyle = {
  fontFamily: LABEL_FONT_FAMILY,
  fontWeight: 600,
  fontPx: 14,
  color: '#1F2A33',
  halo: PAPER,
  chip: null,
  leader: { color: HORIZON, width: 1, dash: [3, 2] },
  uppercase: false,
};

/** Ridgelines far to near, computed once per scene. */
const sortedRidges = new WeakMap<PanoramaScene, Ridgeline[]>();

function farToNear(scene: PanoramaScene): Ridgeline[] {
  let r = sortedRidges.get(scene);
  if (!r) {
    r = [...scene.ridgelines].sort((a, b) => b.minDist - a.minDist);
    sortedRidges.set(scene, r);
  }
  return r;
}

/** Distance → color on a log scale from 1 km (near, dark) to the radius (far, pale). */
function distColor(dist: number, radiusM: number): string {
  const t = Math.min(1, Math.max(0, Math.log(dist / 1000) / Math.log(radiusM / 1000)));
  const c = NEAR.map((n, i) => Math.round(n + (FAR[i]! - n) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Debug style: every ridgeline as a plain line colored by distance, visible sea in blue,
 * the outer horizon in red, and a degree grid. Draws any slice of the panorama.
 */
export const debugStyle: PanoramaStyle = {
  id: 'debug',
  name: 'Debug',
  paper: () => PAPER,
  ground: () => PAPER,
  uses: [],
  labelStyle: LABEL_STYLE,
  render(ctx, scene, v, opts) {
    const { width, height, pxPerDeg: ppd } = v;
    const ppy = ppd * v.exaggeration;
    const angleBottom = v.angleAtTop - height / ppy;
    const step = scene.azStep;
    const n = scene.horizonAngle.length;
    // Rays covering the slice (unwrapped indices), plus one on each side.
    const r0 = Math.floor(v.azStart / step) - 1;
    const r1 = Math.ceil((v.azStart + width / ppd) / step) + 1;
    const rayX = (rr: number) => (rr * step - v.azStart) * ppd;
    const ray = (rr: number) => ((rr % n) + n) % n;

    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    // Sea, one column per ray.
    ctx.fillStyle = SEA;
    const { offsets, lo, hi } = scene.sea;
    const colW = step * ppd;
    for (let rr = r0; rr <= r1; rr++) {
      const r = ray(rr);
      for (let i = offsets[r]!; i < offsets[r + 1]!; i++) {
        const yTop = v.angleToY(hi[i]!);
        ctx.fillRect(rayX(rr) - colW / 2, yTop, colW + 0.5, v.angleToY(lo[i]!) - yTop);
      }
    }

    // Grid
    ctx.lineWidth = 1;
    const hStep = gridStep(ppy, 28);
    for (let a = Math.ceil(angleBottom / hStep) * hStep; a <= v.angleAtTop; a += hStep) {
      ctx.strokeStyle = Math.abs(a) < 1e-9 ? 'rgba(31,42,51,0.45)' : 'rgba(138,145,153,0.25)';
      const y = Math.round(v.angleToY(a)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }
    const vStep = gridStep(ppd, 48);
    for (
      let az = Math.floor(v.azStart / vStep) * vStep;
      az <= v.azStart + width / ppd;
      az += vStep
    ) {
      const cardinal = Math.abs(wrap180(az) % 90) < 1e-9;
      ctx.strokeStyle = cardinal ? 'rgba(31,42,51,0.4)' : 'rgba(138,145,153,0.25)';
      const x = Math.round((az - v.azStart) * ppd) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // Ridgelines, far first so near ones end up on top. Only points near the slice are
    // used; the margin makes lines that cross the slice edge continue to it.
    const margin = 2 * step * ppd + 4;
    const maxGap = step * 1.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const r of farToNear(scene)) {
      let started = false;
      let penDown = false;
      let prevAz = 0;
      for (const p of r.points) {
        const x = v.azToX(p.az);
        if (x < -margin || x > width + margin) {
          penDown = false;
          continue;
        }
        if (!started) {
          const mid = (r.minDist + r.maxDist) / 2;
          ctx.strokeStyle = distColor(mid, scene.radiusM);
          ctx.lineWidth = mid < 10_000 ? 1.6 : mid < 50_000 ? 1.2 : 1;
          ctx.beginPath();
          started = true;
        }
        const y = v.angleToY(p.angle);
        if (penDown && Math.abs(wrap180(p.az - prevAz)) <= maxGap) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        penDown = true;
        prevAz = p.az;
      }
      if (started) ctx.stroke();
    }

    // Outer horizon: at most one vertex every ~2 px (highest ray wins), so ray-to-ray
    // noise doesn't turn into sub-pixel zigzag when zoomed out.
    ctx.strokeStyle = HORIZON;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const k = raysPerVertex(n, step * ppd, 2);
    for (const line of rayEnvelope((rr) => scene.horizonAngle[ray(rr)]!, r0, r1, k)) {
      line.forEach(([pos, a], i) => {
        if (i === 0) ctx.moveTo(rayX(pos), v.angleToY(a));
        else ctx.lineTo(rayX(pos), v.angleToY(a));
      });
    }
    ctx.stroke();
    drawPeakLabels(ctx, v, opts.labels, LABEL_STYLE, opts.labelScale);
  },
};
