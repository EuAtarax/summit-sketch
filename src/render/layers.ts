import type { PanoramaScene } from '../horizon/scene';
import { rayEnvelope, raysPerVertex } from './envelope';
import { rand01 } from './random';
import { indexScene, ridgeRuns, type RidgeRun, type SceneIndex } from './sceneIndex';
import type { ViewTransform } from './viewTransform';

/**
 * Shared painting primitives. All positions derive from absolute azimuth/angle, so
 * adjacent tiles (and the 0°/360° seam) render identical geometry.
 */
export interface Slice {
  ctx: CanvasRenderingContext2D;
  scene: PanoramaScene;
  v: ViewTransform;
  idx: SceneIndex;
  runs: RidgeRun[];
  /** Below the slice, for polygons that extend "down to the bottom". */
  bottomY: number;
  x(run: RidgeRun, i: number): number;
  /** Absolute azimuth of point i of a run, in [0, 360). */
  az(run: RidgeRun, i: number): number;
}

export function makeSlice(
  ctx: CanvasRenderingContext2D,
  scene: PanoramaScene,
  v: ViewTransform,
  marginPx = 64,
): Slice {
  const idx = indexScene(scene);
  const step = idx.azStep;
  const margin = marginPx / v.pxPerDeg;
  return {
    ctx,
    scene,
    v,
    idx,
    runs: ridgeRuns(idx, v.azStart, v.azStart + v.width / v.pxPerDeg, margin),
    bottomY: v.height + 32,
    x: (run, i) => (run.r.az0 + i * step + run.shift - v.azStart) * v.pxPerDeg,
    az: (run, i) => (((run.r.az0 + i * step) % 360) + 360) % 360,
  };
}

/**
 * A lattice with a whole number of cells around the circle, about targetPx apart at this
 * zoom. Hatching and wobble use it so their patterns are periodic at north.
 */
export function periodicLattice(
  pxPerDeg: number,
  targetPx: number,
): { deg: number; count: number } {
  const count = Math.max(8, Math.round((360 * pxPerDeg) / targetPx));
  return { deg: 360 / count, count };
}

/** Smooth periodic value noise in [-1, 1] over a lattice of `count` cells. */
export function periodicNoise(seed: number, x: number, count: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand01(seed, ((i % count) + count) % count) * 2 - 1;
  const b = rand01(seed, (((i + 1) % count) + count) % count) * 2 - 1;
  return a + (b - a) * f * f * (3 - 2 * f);
}

/** Vertical gradient by elevation angle: stops are [angle°, color], any order. */
export function fillSky(s: Slice, stops: [number, string][]): void {
  const { ctx, v } = s;
  const sorted = [...stops].sort((a, b) => b[0] - a[0]);
  const top = sorted[0]![0];
  const bottom = sorted[sorted.length - 1]![0];
  const g = ctx.createLinearGradient(0, v.angleToY(top), 0, v.angleToY(bottom));
  for (const [a, c] of sorted) g.addColorStop((top - a) / (top - bottom || 1), c);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, v.width, v.height);
}

/** The outer horizon filled down to the bottom: guarantees no sky shows below the skyline. */
export function fillBackdrop(s: Slice, color: string): void {
  const { ctx, v, scene } = s;
  const step = scene.azStep;
  const n = scene.horizonAngle.length;
  const r0 = Math.floor(v.azStart / step) - 2;
  const r1 = Math.ceil((v.azStart + v.width / v.pxPerDeg) / step) + 2;
  const k = raysPerVertex(n, step * v.pxPerDeg, 2);
  const ray = (rr: number) => scene.horizonAngle[((rr % n) + n) % n]!;
  ctx.fillStyle = color;
  for (const line of rayEnvelope(ray, r0, r1, k)) {
    ctx.beginPath();
    line.forEach(([pos, a], i) => {
      const x = (pos * step - v.azStart) * v.pxPerDeg;
      if (i === 0) ctx.moveTo(x, s.bottomY);
      ctx.lineTo(x, v.angleToY(a));
    });
    const last = line[line.length - 1]!;
    ctx.lineTo((last[0] * step - v.azStart) * v.pxPerDeg, s.bottomY);
    ctx.fill();
  }
}

/**
 * How far (degrees) the lowest crest in a column owns the terrain below it before the
 * foreground layer (see fillForeground) takes over.
 */
export const FACE_DEG = 2.5;

/**
 * Traces the terrain a ridge owns in the image: from its crest down to the next nearer
 * crest in each ray, or FACE_DEG below the crest if nothing nearer is below it. Ends are
 * tapered like mountain flanks so fragment ends don't show hard vertical edges. All
 * geometry comes from absolute angles (never the tile edge), so tiles agree.
 * Call ctx.fill() afterwards.
 */
export function bandPath(
  s: Slice,
  run: RidgeRun,
  o: {
    /** Start this far below the crest (for layered effects like mist). */
    topOffsetDeg?: number;
    /** How far the lowest crest of a column owns the terrain below it. */
    faceDeg?: number;
    /** Never extend more than this far below the crest (the style fills the rest). */
    maxDepthDeg?: number;
  } = {},
): void {
  const { ctx, v } = s;
  const pts = run.r.ridge.points;
  const face = o.faceDeg ?? FACE_DEG;
  const offset = o.topOffsetDeg ?? 0;
  const maxDepth = o.maxDepthDeg ?? Infinity;
  const yBot = (i: number) => {
    const crest = pts[i]!.angle;
    const b = run.r.below[i]!;
    return v.angleToY(Math.max(b > -90 ? b : crest - face, crest - maxDepth));
  };
  const yTop = (i: number) => Math.min(v.angleToY(pts[i]!.angle - offset), yBot(i));
  const taper = (i: number) => Math.min(36, Math.max(3, (yBot(i) - yTop(i)) * 0.6));
  ctx.beginPath();
  // Left flank (only at the real end of the ridge, not where the slice cuts it).
  if (run.i0 === 0) {
    ctx.moveTo(s.x(run, 0) - taper(0), yBot(0));
    ctx.lineTo(s.x(run, 0), yTop(0));
  } else {
    ctx.moveTo(s.x(run, run.i0), yTop(run.i0));
  }
  for (let i = run.i0 + 1; i <= run.i1; i++) ctx.lineTo(s.x(run, i), yTop(i));
  const last = pts.length - 1;
  if (run.i1 === last) ctx.lineTo(s.x(run, last) + taper(last), yBot(last));
  for (let i = run.i1; i >= run.i0; i--) ctx.lineTo(s.x(run, i), yBot(i));
  ctx.closePath();
}

/**
 * The foreground: everything more than FACE_DEG below the lowest crest of each column,
 * i.e. terrain nearer than every crest there. Filled in one color so fragment ends of
 * near ridges don't leave vertical edges down to the bottom.
 */
export function fillForeground(s: Slice, color: string, faceDeg = FACE_DEG): void {
  const { ctx, v, scene, idx } = s;
  const step = scene.azStep;
  const n = idx.lowest.length;
  const r0 = Math.floor(v.azStart / step) - 2;
  const r1 = Math.ceil((v.azStart + v.width / v.pxPerDeg) / step) + 2;
  const k = raysPerVertex(n, step * v.pxPerDeg, 2);
  // Lowest envelope: negate, take the upper envelope, negate back.
  const lines = rayEnvelope((rr) => -idx.lowest[((rr % n) + n) % n]!, r0, r1, k);
  ctx.fillStyle = color;
  for (const line of lines) {
    ctx.beginPath();
    line.forEach(([pos, negA], i) => {
      const x = (pos * step - v.azStart) * v.pxPerDeg;
      if (i === 0) ctx.moveTo(x, s.bottomY);
      ctx.lineTo(x, v.angleToY(-negA - faceDeg));
    });
    const last = line[line.length - 1]!;
    ctx.lineTo((last[0] * step - v.azStart) * v.pxPerDeg, s.bottomY);
    ctx.fill();
  }
}

/** Polyline along the crest of a run, with an optional vertical offset per point. */
export function crestPath(s: Slice, run: RidgeRun, dy: (i: number) => number = () => 0): void {
  const { ctx, v } = s;
  const pts = run.r.ridge.points;
  ctx.beginPath();
  for (let i = run.i0; i <= run.i1; i++) {
    const x = s.x(run, i);
    const y = v.angleToY(pts[i]!.angle) + dy(i);
    if (i === run.i0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
}

/** Calls fn for each visible sea interval in the slice, with its column rectangle. */
export function forEachSea(
  s: Slice,
  fn: (x: number, w: number, yTop: number, yBottom: number, nearM: number, farM: number) => void,
): void {
  const { v, scene } = s;
  const step = scene.azStep;
  const n = scene.horizonAngle.length;
  const { offsets, lo, hi, loDist, hiDist } = scene.sea;
  const r0 = Math.floor(v.azStart / step) - 1;
  const r1 = Math.ceil((v.azStart + v.width / v.pxPerDeg) / step) + 1;
  const w = step * v.pxPerDeg;
  for (let rr = r0; rr <= r1; rr++) {
    const r = ((rr % n) + n) % n;
    const x = (rr * step - v.azStart) * v.pxPerDeg - w / 2;
    for (let i = offsets[r]!; i < offsets[r + 1]!; i++) {
      fn(x, w + 0.6, v.angleToY(hi[i]!), v.angleToY(lo[i]!), loDist[i]!, hiDist[i]!);
    }
  }
}
