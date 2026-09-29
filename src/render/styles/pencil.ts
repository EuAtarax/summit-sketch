import { rayEnvelope, raysPerVertex } from '../envelope';
import { makeSlice, crestPath, forEachSea, periodicLattice, periodicNoise } from '../layers';
import { rand01 } from '../random';
import { paperGrain } from '../grain';
import { drawPeakLabels, LABEL_FONT_FAMILY, type LabelStyle } from '../labels';
import type { PanoramaStyle } from '../style';

const PAPER = '#F2EEE3';
const GRAPHITE = '43,43,43';
/** Per depth band (0 = nearest). */
const ALPHA = [0.85, 0.72, 0.5, 0.36, 0.26];
const WIDTH = [2.2, 1.7, 1.2, 0.9, 0.8];
const STROKES = [3, 2, 1, 1, 1];
const WOBBLE_PX = [1.3, 1, 0.7, 0.45, 0.3];
const HATCH_DENSITY = [0.9, 0.55, 0.25, 0, 0];

const LABEL_STYLE: LabelStyle = {
  fontFamily: LABEL_FONT_FAMILY,
  fontWeight: 500,
  fontPx: 14,
  color: `rgb(${GRAPHITE})`,
  halo: PAPER,
  chip: null,
  leader: { color: `rgba(${GRAPHITE},0.7)`, width: 0.8, dash: [] },
  uppercase: false,
};

/**
 * Pencil sketch: graphite strokes on off-white paper. Near ridges get 2–3 overlapping
 * wobbly strokes, far ones a single faint line; short diagonal hatching below near crests
 * fades with distance; procedural paper grain.
 */
export const pencilStyle: PanoramaStyle = {
  id: 'pencil',
  name: 'Pencil sketch',
  paper: () => PAPER,
  ground: () => PAPER,
  uses: [],
  labelStyle: LABEL_STYLE,
  render(ctx, scene, v, opts) {
    const s = makeSlice(ctx, scene, v);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, v.width, v.height);

    const wob = periodicLattice(v.pxPerDeg, 26);
    const hatch = periodicLattice(v.pxPerDeg, 5);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Sea: light horizontal hatching.
    ctx.strokeStyle = `rgba(${GRAPHITE},0.16)`;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    forEachSea(s, (x, w, yTop, yBottom) => {
      for (let y = Math.ceil(yTop / 5) * 5; y < yBottom; y += 5) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + w, y);
      }
    });
    ctx.stroke();

    // Skyline as a faint continuous line, so short dropped fragments leave no gaps.
    ctx.strokeStyle = `rgba(${GRAPHITE},0.3)`;
    ctx.lineWidth = 0.8;
    const n = scene.horizonAngle.length;
    const step = scene.azStep;
    const k = raysPerVertex(n, step * v.pxPerDeg, 2);
    const r0 = Math.floor(v.azStart / step) - 2;
    const r1 = Math.ceil((v.azStart + v.width / v.pxPerDeg) / step) + 2;
    for (const line of rayEnvelope((rr) => scene.horizonAngle[((rr % n) + n) % n]!, r0, r1, k)) {
      ctx.beginPath();
      line.forEach(([pos, a], i) => {
        const x = (pos * step - v.azStart) * v.pxPerDeg;
        if (i === 0) ctx.moveTo(x, v.angleToY(a));
        else ctx.lineTo(x, v.angleToY(a));
      });
      ctx.stroke();
    }

    for (const run of s.runs) {
      const { r } = run;
      const b = r.band;
      const pts = r.ridge.points;

      // Hatching: short diagonal strokes on the lattice, below the crest, within the
      // terrain this crest owns (so they never cross a nearer line).
      if (HATCH_DENSITY[b]! > 0) {
        ctx.strokeStyle = `rgba(${GRAPHITE},${ALPHA[b]! * 0.45})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        const aFirst = r.az0 + run.i0 * step + run.shift;
        const aLast = r.az0 + run.i1 * step + run.shift;
        for (let c = Math.ceil(aFirst / hatch.deg); c * hatch.deg <= aLast; c++) {
          const cell = ((c % hatch.count) + hatch.count) % hatch.count;
          if (rand01(opts.seed ^ r.id, cell) > HATCH_DENSITY[b]!) continue;
          const i = Math.round((c * hatch.deg - r.az0 - run.shift) / step);
          if (i < run.i0 || i > run.i1) continue;
          const x = (c * hatch.deg - v.azStart) * v.pxPerDeg;
          const yTop = v.angleToY(pts[i]!.angle) + 2.5;
          const room = v.angleToY(r.below[i]!) - yTop - 1;
          const len = Math.min(room, 5 + 9 * rand01(opts.seed ^ (r.id * 7), cell));
          if (len < 3) continue;
          ctx.moveTo(x, yTop);
          ctx.lineTo(x - len * 0.55, yTop + len);
        }
        ctx.stroke();
      }

      // Crest strokes: each overlapping stroke gets its own wobble.
      for (let k2 = 0; k2 < STROKES[b]!; k2++) {
        const seed = (opts.seed ^ Math.imul(r.id + 1, 2654435761)) + k2 * 1013;
        const amp = WOBBLE_PX[b]!;
        crestPath(s, run, (i) => {
          const az = s.az(run, i);
          return amp * periodicNoise(seed, az / wob.deg, wob.count) + (k2 - 1) * 0.35;
        });
        ctx.strokeStyle = `rgba(${GRAPHITE},${ALPHA[b]! * (k2 === 0 ? 1 : 0.55)})`;
        ctx.lineWidth = WIDTH[b]! * (k2 === 0 ? 1 : 0.7);
        ctx.stroke();
      }
    }

    // Paper grain over everything, anchored to absolute coordinates.
    const grain = paperGrain();
    if (grain) {
      const pattern = ctx.createPattern(grain, 'repeat');
      if (pattern) {
        const size = grain.width;
        const ox = (v.azStart * v.pxPerDeg) % size;
        const oy = (v.angleAtTop * v.pxPerDeg * v.exaggeration) % size;
        pattern.setTransform(new DOMMatrix().translate(-ox, oy));
        ctx.fillStyle = pattern;
        ctx.fillRect(0, 0, v.width, v.height);
      }
    }

    drawPeakLabels(ctx, v, opts.labels, LABEL_STYLE, opts.labelScale);
  },
};
