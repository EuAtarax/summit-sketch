import type { PanoramaScene } from '../../horizon/scene';
import { snowBandDeg } from '../depth';
import {
  bandPath,
  crestPath,
  FACE_DEG,
  fillBackdrop,
  fillForeground,
  fillSky,
  forEachSea,
  makeSlice,
  type Slice,
} from '../layers';
import { drawPeakLabels, LABEL_FONT_FAMILY, type LabelStyle } from '../labels';
import { mulberry32 } from '../random';
import type { PanoramaStyle } from '../style';
import { wrap180 } from '../viewTransform';

/** Band colors, nearest first: greens → blues → purples. */
const BANDS = ['#3F9B45', '#2A9D8F', '#3B7DD8', '#6A5ACD', '#A597E6'];
const OUTLINE = '#1F2A33';
const SKY_TOP = '#4DB2F5';
const SKY_HORIZON = '#D6F2FF';
const SEA = '#2F9BD8';
const SNOW = '#FFFFFF';

interface Cloud {
  az: number;
  angle: number;
  /** Puffs as [Δaz°, Δangle°, radius°]. */
  puffs: [number, number, number][];
}

const cloudCache = new WeakMap<PanoramaScene, Cloud[]>();

/** 3–5 seeded puffy clouds a little above the skyline. */
function cloudsFor(scene: PanoramaScene, seed: number): Cloud[] {
  const hit = cloudCache.get(scene);
  if (hit) return hit;
  const rnd = mulberry32(seed ^ 0xc10d);
  const n = scene.horizonAngle.length;
  const clouds: Cloud[] = [];
  const count = 3 + Math.floor(rnd() * 3);
  for (let c = 0; c < count; c++) {
    const az = rnd() * 360;
    const sky = scene.horizonAngle[Math.floor((az / 360) * n) % n] || 0;
    const size = 1.2 + rnd() * 1.6;
    const puffs: [number, number, number][] = [];
    const k = 4 + Math.floor(rnd() * 3);
    for (let i = 0; i < k; i++) {
      const t = i / (k - 1) - 0.5;
      puffs.push([t * size * 3.2, (1 - 4 * t * t) * size * 0.5, size * (0.55 + rnd() * 0.45)]);
    }
    clouds.push({ az, angle: Math.max(sky, 0) + 3 + rnd() * 5, puffs });
  }
  cloudCache.set(scene, clouds);
  return clouds;
}

function drawClouds(s: Slice, seed: number): void {
  const { ctx, v } = s;
  const center = v.azStart + v.width / 2 / v.pxPerDeg;
  for (const c of cloudsFor(s.scene, seed)) {
    const dAz = wrap180(c.az - center);
    const cx = v.width / 2 + dAz * v.pxPerDeg;
    const cy = v.angleToY(c.angle);
    // Flat shadow underneath, then the white puffs.
    for (const [fill, dy] of [
      ['rgba(31,42,51,0.08)', 3],
      ['#FFFFFF', 0],
    ] as const) {
      ctx.fillStyle = fill;
      ctx.beginPath();
      for (const [dx, da, r] of c.puffs) {
        const px = cx + dx * v.pxPerDeg;
        const py = cy - da * v.pxPerDeg + dy;
        ctx.moveTo(px + r * v.pxPerDeg, py);
        ctx.arc(px, py, r * v.pxPerDeg, 0, Math.PI * 2);
      }
      ctx.fill();
    }
  }
}

const LABEL_STYLE: LabelStyle = {
  fontFamily: LABEL_FONT_FAMILY,
  fontWeight: 700,
  fontPx: 14,
  color: OUTLINE,
  halo: null,
  chip: { fill: '#FFFFFF', stroke: OUTLINE },
  leader: { color: OUTLINE, width: 1.5, dash: [] },
  uppercase: false,
};

/**
 * Cartoon: bold, flat, saturated bands by depth, 3 px outlines on the three nearest
 * bands, white snow caps with a scalloped lower edge, a gradient sky and seeded clouds.
 */
export const cartoonStyle: PanoramaStyle = {
  id: 'cartoon',
  name: 'Cartoon',
  paper: () => SKY_TOP,
  ground: () => BANDS[0]!,
  uses: ['snowline'],
  labelStyle: LABEL_STYLE,
  render(ctx, scene, v, opts) {
    const s = makeSlice(ctx, scene, v);
    fillSky(s, [
      [0, SKY_HORIZON],
      [40, SKY_TOP],
    ]);
    drawClouds(s, opts.seed);
    fillBackdrop(s, BANDS[4]!);

    // Scallops: a periodic bump along azimuth, ~14 px wide at this zoom.
    const scallopDeg = 360 / Math.max(8, Math.round((360 * v.pxPerDeg) / 14));
    // Snow caps stay caps: at most ~12 px thick on screen.
    const maxSnowDeg = 12 / (v.pxPerDeg * v.exaggeration);
    const snowDeg = (elev: number, dist: number) =>
      Math.min(maxSnowDeg, snowBandDeg(elev, opts.snowlineM, dist));
    for (const run of s.runs) {
      const { r } = run;
      const pts = r.ridge.points;
      ctx.fillStyle = BANDS[r.band]!;
      bandPath(s, run);
      ctx.fill();

      // Snow cap: from the crest down by the snow thickness, never below the next crest.
      let open = false;
      ctx.fillStyle = SNOW;
      const flush = (upTo: number, from: number) => {
        // Close the cap: go back along the scalloped lower edge.
        for (let j = upTo; j >= from; j--) {
          const p = pts[j]!;
          const deg = snowDeg(p.elev, p.dist);
          const phase = (s.az(run, j) / scallopDeg) % 1;
          const scallop = 0.72 + 0.28 * Math.sin(Math.PI * phase);
          const floor = r.below[j]! > -90 ? r.below[j]! : p.angle - FACE_DEG;
          const y = Math.min(v.angleToY(p.angle - deg * scallop), v.angleToY(floor));
          ctx.lineTo(s.x(run, j), y);
        }
        ctx.closePath();
        ctx.fill();
      };
      let start = run.i0;
      for (let i = run.i0; i <= run.i1 + 1; i++) {
        const p = pts[i];
        const snowy = i <= run.i1 && p !== undefined && snowDeg(p.elev, p.dist) > 0;
        if (snowy && !open) {
          open = true;
          start = i;
          ctx.beginPath();
          ctx.moveTo(s.x(run, i), v.angleToY(p.angle));
        } else if (snowy && open) {
          ctx.lineTo(s.x(run, i), v.angleToY(p.angle));
        } else if (!snowy && open) {
          open = false;
          flush(i - 1, start);
        }
      }
    }

    fillForeground(s, BANDS[0]!);

    forEachSea(s, (x, w, yTop, yBottom) => {
      ctx.fillStyle = SEA;
      ctx.fillRect(x, yTop, w, yBottom - yTop);
    });

    // Outlines on the three nearest bands, drawn last: crests are always visible.
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 3;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (const run of s.runs) {
      if (run.r.band > 2) continue;
      crestPath(s, run);
      ctx.stroke();
    }

    drawPeakLabels(ctx, v, opts.labels, LABEL_STYLE);
  },
};
