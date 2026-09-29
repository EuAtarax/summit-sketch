import type { GridGeometry } from './terrain';

/** Each preference has an on/off switch and the distance up to which a cell counts as near. */
export interface NearbyPreference {
  enabled: boolean;
  /** Meters. */
  maxM: number;
}

export interface NearbyParams {
  trail: NearbyPreference;
  water: NearbyPreference;
  drinking: NearbyPreference;
}

export const DEFAULT_NEARBY: NearbyParams = {
  trail: { enabled: true, maxM: 300 },
  water: { enabled: true, maxM: 400 },
  drinking: { enabled: true, maxM: 800 },
};

/**
 * How much being far away hurts. A trail matters most (a floor of 0.15 means a cell far from any
 * trail is still shown, but weak), water and drinking water are nice to have.
 */
export const FLOORS = { trail: 0.15, water: 0.5, drinking: 0.6 } as const;
/** Ground this close to a path is the path itself, not a place to pitch a tent. */
export const TRAIL_CLEARANCE_M = 8;
const ON_TRAIL_FACTOR = 0.2;

/**
 * 1 up to `maxM`, then fading linearly to `floor` at twice that distance. Infinity (no such
 * feature in the area at all) gets the floor.
 */
export function nearnessFactor(distanceM: number, maxM: number, floor: number): number {
  if (!(distanceM > maxM)) return 1;
  if (distanceM === Infinity) return floor;
  return floor + (1 - floor) * Math.max(0, 1 - (distanceM - maxM) / maxM);
}

export interface ScoreInputs {
  suitability: Float32Array;
  /** Meters to the nearest trail, water line and drinking-water source; absent when unknown. */
  trailDistance?: Float32Array;
  waterDistance?: Float32Array;
  drinkingDistance?: Float32Array;
  /** 1-based index of the protected area on each cell (0 = none) and whether each is in force. */
  protection?: { index: Uint8Array; inForce: readonly boolean[] };
}

/**
 * Camp score: terrain suitability, weighted by nearness to trails, water and drinking water,
 * and cut to zero on ground where a protection is in force (when asked). Unknown distances
 * (the OSM service was unreachable) do not penalize: unknown is not the same as far.
 */
export function campScore(
  inputs: ScoreInputs,
  nearby: NearbyParams,
  hideProtected: boolean,
): Float32Array {
  const { suitability, trailDistance, waterDistance, drinkingDistance, protection } = inputs;
  const out = new Float32Array(suitability.length);
  for (let i = 0; i < out.length; i++) {
    let score = suitability[i]!;
    if (Number.isNaN(score) || score === 0) {
      out[i] = score;
      continue;
    }
    if (nearby.trail.enabled && trailDistance) {
      const d = trailDistance[i]!;
      score *=
        d < TRAIL_CLEARANCE_M
          ? ON_TRAIL_FACTOR
          : nearnessFactor(d, nearby.trail.maxM, FLOORS.trail);
    }
    if (nearby.water.enabled && waterDistance) {
      score *= nearnessFactor(waterDistance[i]!, nearby.water.maxM, FLOORS.water);
    }
    if (nearby.drinking.enabled && drinkingDistance) {
      score *= nearnessFactor(drinkingDistance[i]!, nearby.drinking.maxM, FLOORS.drinking);
    }
    if (hideProtected && protection) {
      const area = protection.index[i]!;
      if (area > 0 && protection.inForce[area - 1]) score = 0;
    }
    out[i] = score;
  }
  return out;
}

export interface Spot {
  rank: number;
  col: number;
  row: number;
  /** LV95 position of the cell center. */
  e: number;
  n: number;
  score: number;
}

const BLOCK_M = 10;

/**
 * The best places, one per neighbourhood: the best cell of each 10 m block, best first,
 * skipping any that lies within `minSeparationM` of one already chosen.
 */
export function pickSpots(
  score: Float32Array,
  g: GridGeometry,
  options: { count?: number; minSeparationM?: number; minScore?: number } = {},
): Spot[] {
  const { count = 5, minSeparationM = 150, minScore = 0.5 } = options;
  const block = Math.max(1, Math.round(BLOCK_M / g.cell));
  const candidates: { col: number; row: number; score: number }[] = [];
  for (let by = 0; by < g.height; by += block) {
    for (let bx = 0; bx < g.width; bx += block) {
      let best = -1;
      let bestCol = 0;
      let bestRow = 0;
      for (let y = by; y < Math.min(by + block, g.height); y++) {
        for (let x = bx; x < Math.min(bx + block, g.width); x++) {
          const v = score[y * g.width + x]!;
          if (v > best) {
            best = v;
            bestCol = x;
            bestRow = y;
          }
        }
      }
      if (best >= minScore) candidates.push({ col: bestCol, row: bestRow, score: best });
    }
  }
  candidates.sort((a, b) => b.score - a.score);

  const spots: Spot[] = [];
  for (const c of candidates) {
    if (spots.length >= count) break;
    const e = g.e0 + (c.col + 0.5) * g.cell;
    const n = g.n0 - (c.row + 0.5) * g.cell;
    if (spots.some((s) => Math.hypot(s.e - e, s.n - n) < minSeparationM)) continue;
    spots.push({ rank: spots.length + 1, col: c.col, row: c.row, e, n, score: c.score });
  }
  return spots;
}
