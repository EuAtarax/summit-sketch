import { distanceM, elevationAngleDeg, initialBearingDeg } from '../geo/geodesy';
import type { PanoramaScene } from '../horizon/scene';
import { runningMaxAngle } from './crestLookup';
import type { Peak } from './overpass';

/** Peaks closer than this are the observer's own summit or its cairn, not part of the view. */
export const MIN_PEAK_DIST_M = 300;
/** Terrain within the last 2% of the distance is the peak's own slope, not an obstruction. */
export const OCCLUSION_DIST_FRACTION = 0.98;
/** Slack for DEM and ray-grid discretization, degrees. */
export const ANGLE_TOLERANCE_DEG = 0.05;

/** A peak seen from the observer: where it is, before its elevation is known. */
export interface PeakSighting {
  peak: Peak;
  /** Bearing from the observer, degrees in [0, 360). */
  az: number;
  dist: number;
}

/** A peak that is visible in the panorama, at its apparent position. */
export interface VisiblePeak extends PeakSighting {
  /** Apparent elevation angle of the summit, degrees. */
  angle: number;
  /** Summit elevation used, meters (OSM `ele`, else the DEM). */
  elev: number;
}

/** Peaks inside the panorama radius (and not the observer's own summit), with bearing and distance. */
export function peakSightings(scene: PanoramaScene, peaks: readonly Peak[]): PeakSighting[] {
  const { lat, lon } = scene.observer;
  const out: PeakSighting[] = [];
  for (const peak of peaks) {
    const dist = distanceM(lat, lon, peak.lat, peak.lon);
    if (dist < MIN_PEAK_DIST_M || dist > scene.radiusM) continue;
    out.push({ peak, az: initialBearingDeg(lat, lon, peak.lat, peak.lon), dist });
  }
  return out;
}

/** Sightings whose elevation must come from the DEM because OSM has no usable `ele`. */
export function needsDemElevation(sightings: readonly PeakSighting[]): PeakSighting[] {
  return sightings.filter((s) => s.peak.ele === null);
}

/**
 * Peaks visible from the observer. A peak is visible when its apparent angle reaches the
 * running max angle of the terrain in front of it (up to 98% of its distance), less a small
 * tolerance. OSM `ele` is preferred over the DEM, which blunts summits; peaks with neither
 * are dropped.
 */
export function visiblePeaks(
  scene: PanoramaScene,
  sightings: readonly PeakSighting[],
  demElevations: ReadonlyMap<number, number>,
): VisiblePeak[] {
  const { groundElev, eyeHeight } = scene.observer;
  const out: VisiblePeak[] = [];
  for (const s of sightings) {
    const elev = s.peak.ele ?? demElevations.get(s.peak.id);
    if (elev === undefined || !Number.isFinite(elev)) continue;
    const angle = elevationAngleDeg(elev, groundElev + eyeHeight, s.dist);
    const blocking = runningMaxAngle(scene, s.az, s.dist * OCCLUSION_DIST_FRACTION);
    if (angle >= blocking - ANGLE_TOLERANCE_DEG) out.push({ ...s, angle, elev });
  }
  return out;
}
