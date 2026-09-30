import { formatDistance } from '../ui/format';
import type { AnalysisResult, AreaInfo } from './pipeline';
import { hidesGround } from './protection';
import { pointInPolygon } from './raster';
import type { Spot } from './scoring';

export const NO_GOOD_SPOTS =
  'No good spot in this box. Try a different place, a larger area, or loosen the pitch settings.';

/** One line of the list of best spots. */
export interface SpotItem {
  rank: number;
  title: string;
  detail: string;
}

/** "120 m" below a kilometer (rounded to 10 m), "1.4 km" above. */
export function formatMeters(d: number): string {
  return d < 1000 ? `${Math.round(d / 10) * 10} m` : formatDistance(d);
}

/** A signed slider value: "+300 m" (within), "-300 m" (at least that far), "Off" for 0. */
export function formatSignedMeters(value: number): string {
  return value === 0 ? 'Off' : `${value > 0 ? '+' : '-'}${Math.abs(value)} m`;
}

/**
 * Score and surroundings of a spot as one list entry: slope, distance to the nearest trail,
 * water and drinking water (or that the box has none), and the protected area it lies in.
 */
export function describeSpot(res: AnalysisResult, spot: Spot): SpotItem {
  return {
    rank: spot.rank,
    title: `#${spot.rank}   score ${Math.round(spot.score * 100)} %`,
    detail: describeCell(res, spot.col, spot.row),
  };
}

/** The facts about one grid cell as a comma-separated line (see describeSpot). */
export function describeCell(res: AnalysisResult, col: number, row: number): string {
  const i = row * res.geometry.width + col;
  const near = (label: string, distances: Float32Array | undefined): string | null => {
    if (!distances) return null; // unknown (service unreachable): say nothing
    return Number.isFinite(distances[i]!)
      ? `${formatMeters(distances[i]!)} from ${label}`
      : `no ${label} in this box`;
  };
  const g = res.geometry;
  const areas = areasAt(res, g.e0 + (col + 0.5) * g.cell, g.n0 - (row + 0.5) * g.cell);
  const parts = [
    `${Math.round(res.slope[i]!)}° slope`,
    near('a trail', res.trailDistance),
    near('water', res.waterDistance),
    near('drinking water', res.drinkingDistance),
    ...areas.map((a) => `in ${a.kind}: ${a.name}${notInForce(a) ? ' (not in force today)' : ''}`),
  ];
  return parts.filter(Boolean).join(', ');
}

/** A restriction that exists but does not apply today (a winter refuge in summer). */
const notInForce = (a: AreaInfo): boolean => a.restricts && !a.inForce;

/**
 * 0 = not protected, 1 = flagged but hides nothing today (out of season, or a large area listed
 * for information), 2 = a restriction in force (for the map layer).
 */
export function protectedLayer(res: AnalysisResult): Float32Array | null {
  const index = res.protectionIndex;
  if (!index) return null;
  const out = new Float32Array(index.length);
  index.forEach((area, i) => {
    out[i] = area === 0 ? 0 : hidesGround(res.areas[area - 1]!) ? 2 : 1;
  });
  return out;
}

/** The strictest protected area that contains an LV95 position, or null (also when none was loaded). */
export function protectionAt(res: AnalysisResult, e: number, n: number): AreaInfo | null {
  return areasAt(res, e, n)[0] ?? null;
}

/**
 * Every protected area that contains an LV95 position, strictest first (a restriction in
 * force, then one out of season, then areas listed for information). Uses the outlines when
 * the worker still has them, else the painted grid, which holds only the strictest area.
 */
export function areasAt(res: AnalysisResult, e: number, n: number): AreaInfo[] {
  const g = res.geometry;
  const col = Math.floor((e - g.e0) / g.cell);
  const row = Math.floor((g.n0 - n) / g.cell);
  if (col < 0 || row < 0 || col >= g.width || row >= g.height) return [];
  if (res.areaShapes) {
    // `areas` is sorted weakest first (see parseProtectedAreas), so reverse for strictest first.
    return res.areas
      .filter((_, k) => res.areaShapes![k]!.some((p) => pointInPolygon([e, n], p)))
      .reverse();
  }
  const index = res.protectionIndex?.[row * g.width + col] ?? 0;
  return index > 0 ? [res.areas[index - 1]!] : [];
}

/** The short warning for a chosen spot inside a protected area. Never says camping is allowed. */
export function restrictionNotice(area: AreaInfo): string {
  if (!area.restricts) return `In ${area.kind}: ${area.name}. Check local rules.`;
  const state = area.inForce ? 'in force today' : 'not in force today';
  return `In ${area.kind}: ${area.name} (${state}). Check local rules.`;
}
