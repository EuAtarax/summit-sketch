import { shareAbove } from './analysis';
import { formatDistance } from '../ui/format';
import type { AnalysisResult } from './pipeline';
import type { Spot } from './scoring';

/** A cell counts as pitchable from this suitability on (for the summary numbers). */
export const PITCHABLE = 0.5;

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
  const areaIndex = res.protectionIndex?.[i] ?? 0;
  const area = areaIndex > 0 ? res.areas[areaIndex - 1]! : null;
  const parts = [
    `${Math.round(res.slope[i]!)}° slope`,
    near('a trail', res.trailDistance),
    near('water', res.waterDistance),
    near('drinking water', res.drinkingDistance),
    area ? `in ${area.kind}: ${area.name}${area.inForce ? '' : ' (not in force today)'}` : null,
  ];
  return parts.filter(Boolean).join(', ');
}

/** 0 = not protected, 1 = protected but not in force today, 2 = in force (for the map layer). */
export function protectedLayer(res: AnalysisResult): Float32Array | null {
  const index = res.protectionIndex;
  if (!index) return null;
  const out = new Float32Array(index.length);
  index.forEach((area, i) => {
    out[i] = area === 0 ? 0 : res.areas[area - 1]!.inForce ? 2 : 1;
  });
  return out;
}

/** Hectares of good terrain that a protection in force takes out of the score. */
export function hiddenHectares(res: AnalysisResult, terrain: Float32Array): number {
  const index = res.protectionIndex;
  if (!index) return 0;
  let cells = 0;
  index.forEach((area, i) => {
    if (area > 0 && res.areas[area - 1]!.inForce && terrain[i]! >= PITCHABLE) cells++;
  });
  return (cells * res.geometry.cell * res.geometry.cell) / 10_000;
}

/** The status line: box size, time, how much of it is good, and what protection hid. */
export function summarize(
  res: AnalysisResult,
  terrain: Float32Array,
  score: Float32Array,
  hideProtected: boolean,
): string {
  const sizeM = res.geometry.width * res.geometry.cell;
  const km = (sizeM / 1000).toFixed(1);
  const good = shareAbove(score, PITCHABLE);
  const hectares = (good * sizeM * sizeM) / 10_000;
  const hidden = hideProtected ? hiddenHectares(res, terrain) : 0;
  return (
    `${km} x ${km} km in ${(res.millis / 1000).toFixed(1)} s. ` +
    `${(good * 100).toFixed(1)} % of the area (${hectares.toFixed(1)} ha) has ground you could pitch on.` +
    (hidden >= 0.1 ? ` ${hidden.toFixed(1)} ha more is hidden by protected areas.` : '')
  );
}
