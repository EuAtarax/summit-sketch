import { depthT, mix } from '../depth';
import { bandPath, fillBackdrop, fillSky, forEachSea, makeSlice } from '../layers';
import { drawPeakLabels, LABEL_FONT_FAMILY, type LabelStyle } from '../labels';
import type { PaletteId, PanoramaStyle } from '../style';

interface Palette {
  /** Foreground mountains. */
  near: string;
  /** What distant mountains fade into. */
  haze: string;
  skyHorizon: string;
  skyTop: string;
  sea: string;
}

export const MISTY_PALETTES: Record<PaletteId, Palette> = {
  // Peach haze → violet foreground.
  dawn: {
    near: '#3F2E56',
    haze: '#F2B89B',
    skyHorizon: '#F9D3B8',
    skyTop: '#C3B1DA',
    sea: '#6D6A9C',
  },
  // Blue-greys.
  day: {
    near: '#2C3C4C',
    haze: '#C3D2DC',
    skyHorizon: '#DCE7EE',
    skyTop: '#8DB1CB',
    sea: '#577D98',
  },
  // Orange haze → indigo foreground.
  dusk: {
    near: '#1D1A3B',
    haze: '#E98A5C',
    skyHorizon: '#F4A961',
    skyTop: '#3A3470',
    sea: '#3E3A73',
  },
};

/** Degrees below a crest at which its layer has faded completely into the mist. */
const MIST_DEG = 4;
/** [offset below the crest in degrees, haze alpha]: cumulative fade to pure haze. */
const MIST_STEPS: [number, number][] = [
  [0.8, 0.2],
  [1.6, 0.3],
  [2.4, 0.4],
  [3.2, 0.55],
  [MIST_DEG, 1],
];

/** Ridge color: from the foreground color toward the haze, on a log distance scale. */
function layerColor(p: Palette, distM: number, radiusM: number): string {
  return mix(p.near, p.haze, 0.08 + 0.84 * Math.pow(depthT(distM, radiusM), 0.85));
}

/** A light chip keeps the text readable on all three palettes, dark dusk skies included. */
const LABEL_STYLE: LabelStyle = {
  fontFamily: LABEL_FONT_FAMILY,
  fontWeight: 600,
  fontPx: 14,
  color: '#1F2A33',
  halo: null,
  chip: { fill: 'rgba(255,255,255,0.82)', stroke: null },
  leader: { color: 'rgba(31,42,51,0.8)', width: 1, dash: [], halo: 'rgba(255,255,255,0.75)' },
  uppercase: false,
};

/**
 * Misty layers: flat silhouettes fading into the sky (atmospheric perspective). Painter's
 * fill far to near, no outlines, three palettes.
 */
export const mistyStyle: PanoramaStyle = {
  id: 'misty',
  name: 'Misty layers',
  paper: (o) => MISTY_PALETTES[o.palette].skyTop,
  ground: (o) => MISTY_PALETTES[o.palette].haze,
  uses: ['palette'],
  labelStyle: LABEL_STYLE,
  render(ctx, scene, v, opts) {
    const p = MISTY_PALETTES[opts.palette];
    const s = makeSlice(ctx, scene, v);
    fillSky(s, [
      [0, p.skyHorizon],
      [35, p.skyTop],
    ]);
    // Everything below the skyline starts as mist; each ridge is a silhouette fading into it.
    fillBackdrop(s, p.haze);
    for (const run of s.runs) {
      ctx.fillStyle = layerColor(p, run.r.dist, scene.radiusM);
      bandPath(s, run, { faceDeg: MIST_DEG, maxDepthDeg: MIST_DEG });
      ctx.fill();
      // Mist settles below each crest: stacked haze layers that follow the crest shape
      // and reach pure haze MIST_DEG below it.
      // Skip mist layers that start below this ridge's face (common for far ridges, whose
      // next crest is close underneath): they would be empty.
      const pts = run.r.ridge.points;
      let face = 0;
      for (let i = run.i0; i <= run.i1; i++) {
        const b = run.r.below[i]!;
        face = Math.max(face, b > -90 ? pts[i]!.angle - b : MIST_DEG);
      }
      ctx.fillStyle = p.haze;
      for (const [offset, alpha] of MIST_STEPS) {
        if (offset >= face) break;
        ctx.globalAlpha = alpha;
        bandPath(s, run, { faceDeg: MIST_DEG, maxDepthDeg: MIST_DEG, topOffsetDeg: offset });
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    // Visible sea, hazed by its distance like the land.
    forEachSea(s, (x, w, yTop, yBottom, nearM, farM) => {
      const t = 0.08 + 0.84 * Math.pow(depthT(Math.sqrt(nearM * farM), scene.radiusM), 0.85);
      ctx.fillStyle = mix(p.sea, p.haze, t);
      ctx.fillRect(x, yTop, w, yBottom - yTop);
    });
    drawPeakLabels(ctx, v, opts.labels, LABEL_STYLE, opts.labelScale);
  },
};
