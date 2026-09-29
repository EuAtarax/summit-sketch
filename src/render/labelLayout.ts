import type { LabelMetrics, LabeledPeak } from './labels';

/** A peak to label, already in priority order (most important first). */
export interface LabelCandidate {
  id: number;
  name: string;
  az: number;
  angle: number;
  /** Summit elevation and distance from the observer, meters (shown when a label is tapped). */
  elev: number;
  dist: number;
}

/** The pixel frame labels are laid out in: the tile space of one zoom level. */
export interface LayoutFrame {
  /** CSS px per degree of azimuth. */
  pxPerDeg: number;
  exaggeration: number;
  /** Angle at y = 0, the top of the content (label band included). */
  angleTop: number;
}

/** Stack rows tried per label before giving up. */
const MAX_ROWS = 8;
/** Peaks considered per layout, in priority order. */
const MAX_CANDIDATES = 400;

interface Placed {
  /** Box center x and the summit x, in absolute (unwrapped) frame px. */
  cx: number;
  summitX: number;
  w: number;
  top: number;
  bottom: number;
  summitY: number;
}

interface Point {
  x: number;
  y: number;
}

/** Copy of `p` shifted by whole turns so that it lies nearest to x = near. */
function nearestImage(p: Placed, near: number, period: number): Placed {
  const shift = Math.round((near - p.cx) / period) * period;
  return shift === 0 ? p : { ...p, cx: p.cx + shift, summitX: p.summitX + shift };
}

/** The leader runs from the bottom center of the box to the summit. */
function leaderOf(p: Placed): [Point, Point] {
  return [
    { x: p.cx, y: p.bottom },
    { x: p.summitX, y: p.summitY },
  ];
}

function boxesCollide(a: Placed, b: Placed, spacing: number): boolean {
  if (Math.abs(a.cx - b.cx) >= (a.w + b.w) / 2 + spacing) return false;
  return a.top < b.bottom + spacing && b.top < a.bottom + spacing;
}

/** Liang-Barsky clip: does the segment touch the rectangle? */
function segmentTouchesRect(
  [a, b]: [Point, Point],
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: [number, number][] = [
    [-dx, a.x - x0],
    [dx, x1 - a.x],
    [-dy, a.y - y0],
    [dy, y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function leaderCrossesBox(leader: Placed, box: Placed, spacing: number): boolean {
  return segmentTouchesRect(
    leaderOf(leader),
    box.cx - box.w / 2 - spacing,
    box.top - spacing,
    box.cx + box.w / 2 + spacing,
    box.bottom + spacing,
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  return Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
}

function leadersCross(a: Placed, b: Placed): boolean {
  const [p1, p2] = leaderOf(a);
  const [q1, q2] = leaderOf(b);
  // Strict crossing only: leaders that merely meet at a shared summit are fine.
  return (
    orientation(p1, p2, q1) * orientation(p1, p2, q2) < 0 &&
    orientation(q1, q2, p1) * orientation(q1, q2, p2) < 0
  );
}

function collides(c: Placed, placed: readonly Placed[], period: number, spacing: number): boolean {
  return placed.some((raw) => {
    const p = nearestImage(raw, c.cx, period);
    return (
      boxesCollide(c, p, spacing) ||
      leaderCrossesBox(c, p, spacing) ||
      leaderCrossesBox(p, c, spacing) ||
      leadersCross(c, p)
    );
  });
}

/** Sideways box offsets tried, as fractions of the label width (0 = straight up). */
const SHIFTS = [0, 0.6, -0.6, 1.1, -1.1, 1.7, -1.7];
/** One row of height costs as much as this much sideways shift (in label widths) times 1/this. */
const SHIFT_COST = 1.5;

/** Largest sideways run of a flat leader, in label widths. */
const MAX_FLAT_JOG = 1.2;

/** Spots to try, cheapest first: fewer rows up and less sideways shift are both better. */
const SPOTS = SHIFTS.flatMap((shift) =>
  Array.from({ length: MAX_ROWS }, (_, row) => ({ row, shift })),
).sort((a, b) => a.row + SHIFT_COST * Math.abs(a.shift) - (b.row + SHIFT_COST * Math.abs(b.shift)));

/**
 * Greedy label placement in priority order. Each label is tried in stacked rows above its
 * summit, nearest row and straightest leader first, then higher rows or sideways shifts
 * with a slanted leader. The first spot where neither the box nor its leader touches an
 * already placed label or leader wins. A label with no free spot inside the content is
 * dropped. Deterministic for a given input, and seam-safe: x is a circle of 360 degrees.
 */
export function layoutLabels(
  candidates: readonly LabelCandidate[],
  frame: LayoutFrame,
  textWidth: (name: string) => number,
  metrics: LabelMetrics,
): LabeledPeak[] {
  const period = 360 * frame.pxPerDeg;
  const rowStep = metrics.height + metrics.spacing;
  const placed: Placed[] = [];
  const out: LabeledPeak[] = [];

  for (const c of candidates.slice(0, MAX_CANDIDATES)) {
    const w = Math.ceil(textWidth(c.name)) + 2 * metrics.padX;
    const summitX = c.az * frame.pxPerDeg;
    const summitY = (frame.angleTop - c.angle) * frame.pxPerDeg * frame.exaggeration;
    const spot = findSpot(summitX, summitY, w, placed, period, metrics, rowStep);
    if (!spot) continue;
    placed.push(spot);
    out.push({
      id: c.id,
      name: c.name,
      az: c.az,
      angle: c.angle,
      elev: c.elev,
      dist: c.dist,
      box: { dx: spot.cx - summitX - w / 2, dy: spot.top - summitY, w, h: metrics.height },
    });
  }
  return out;
}

function findSpot(
  summitX: number,
  summitY: number,
  w: number,
  placed: readonly Placed[],
  period: number,
  metrics: LabelMetrics,
  rowStep: number,
): Placed | null {
  for (const { row, shift } of SPOTS) {
    const bottom = summitY - metrics.leaderMin - row * rowStep;
    const top = bottom - metrics.height;
    if (top < 0) continue; // this row leaves the content
    // A long leader must be steep (within 45 degrees of vertical); a jog of about one label
    // width is fine, and is what lets two summits at the same spot sit side by side.
    const run = Math.abs(shift * w);
    if (run > Math.max(summitY - bottom, MAX_FLAT_JOG * w)) continue;
    const candidate: Placed = { cx: summitX + shift * w, summitX, w, top, bottom, summitY };
    if (!collides(candidate, placed, period, metrics.spacing)) return candidate;
  }
  return null;
}
