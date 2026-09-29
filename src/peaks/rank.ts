import { lowestCrestAngleInBand } from './crestLookup';
import type { PanoramaScene } from '../horizon/scene';
import { wrap360 } from '../render/viewTransform';
import type { VisiblePeak } from './visibility';

/** How far to each side of a peak the surrounding terrain is inspected, degrees of azimuth. */
export const PROMINENCE_WINDOW_DEG = 6;
/** Terrain counts as "around the peak" if its distance is within this fraction of the peak's. */
export const SIMILAR_DIST_FRACTION = 0.3;
/** Angular prominence that already earns the full prominence score, degrees. */
export const FULL_PROMINENCE_DEG = 3;
/** Share of the score that comes from elevation (the rest is prominence). */
export const ELEVATION_WEIGHT = 0.5;

export interface RankedPeak extends VisiblePeak {
  /** How far the summit stands above its surroundings, degrees of apparent angle. */
  prominence: number;
  /** 0..1, higher labels first. */
  score: number;
}

/**
 * Angular prominence: summit angle minus the "saddle" angle, where the saddle is the higher
 * of the two sides' lowest crest at a similar distance within the azimuth window. A summit
 * on a long high ridge scores low because one side never drops away; an isolated summit
 * scores high. With no crests at a similar distance the skyline minimum is used instead.
 */
export function angularProminence(scene: PanoramaScene, peak: VisiblePeak): number {
  const lo = peak.dist * (1 - SIMILAR_DIST_FRACTION);
  const hi = peak.dist * (1 + SIMILAR_DIST_FRACTION);
  const steps = Math.round(PROMINENCE_WINDOW_DEG / scene.azStep);
  const sideLows: number[] = [];
  for (const side of [-1, 1]) {
    let lowest: number | null = null;
    for (let i = 1; i <= steps; i++) {
      const a = lowestCrestAngleInBand(scene, wrap360(peak.az + side * i * scene.azStep), lo, hi);
      if (a !== null && (lowest === null || a < lowest)) lowest = a;
    }
    if (lowest !== null) sideLows.push(lowest);
  }
  const saddle = sideLows.length ? Math.max(...sideLows) : skylineMinimum(scene, peak.az, steps);
  return Math.max(0, peak.angle - saddle);
}

function skylineMinimum(scene: PanoramaScene, az: number, steps: number): number {
  const n = scene.horizonAngle.length;
  const center = Math.round(az / scene.azStep);
  let lowest = Infinity;
  for (let i = -steps; i <= steps; i++) {
    const a = scene.horizonAngle[(((center + i) % n) + n) % n]!;
    if (!Number.isNaN(a) && a < lowest) lowest = a;
  }
  return Number.isFinite(lowest) ? lowest : 0;
}

/** Peaks sorted by label priority: half elevation (relative to the highest), half prominence. */
export function rankPeaks(scene: PanoramaScene, peaks: readonly VisiblePeak[]): RankedPeak[] {
  const maxElev = Math.max(1, ...peaks.map((p) => p.elev));
  return peaks
    .map((p) => {
      const prominence = angularProminence(scene, p);
      const score =
        ELEVATION_WEIGHT * Math.max(0, p.elev / maxElev) +
        (1 - ELEVATION_WEIGHT) * Math.min(1, prominence / FULL_PROMINENCE_DEG);
      return { ...p, prominence, score };
    })
    .sort((a, b) => b.score - a.score || a.dist - b.dist);
}
