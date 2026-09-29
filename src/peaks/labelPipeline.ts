import { zoomForDistance } from '../horizon/sampling';
import type { ElevationQuery } from '../horizon/protocol';
import type { PanoramaScene } from '../horizon/scene';
import type { LabelCandidate } from '../render/labelLayout';
import { prepareCrestLookup } from './crestLookup';
import type { Peak } from './overpass';
import { rankPeaks } from './rank';
import { needsDemElevation, peakSightings, visiblePeaks } from './visibility';

export interface LabelPipelineDeps {
  /** Every named peak within the panorama radius (one Overpass request, cached). */
  loadPeaks(lat: number, lon: number, radiusM: number): Promise<Peak[]>;
  /** Summit elevation per query (NaN when unknown); used for peaks without an OSM `ele`. */
  elevations(points: ElevationQuery[]): Promise<Float32Array>;
}

/**
 * Peaks to label for a scene, most important first: load the named peaks, fill in missing
 * elevations from the DEM, keep the ones visible from the observer, rank them.
 */
export async function labelCandidatesFor(
  scene: PanoramaScene,
  deps: LabelPipelineDeps,
): Promise<LabelCandidate[]> {
  const { lat, lon } = scene.observer;
  const peaks = await deps.loadPeaks(lat, lon, scene.radiusM);
  const sightings = peakSightings(scene, peaks);

  const needDem = needsDemElevation(sightings);
  const values = needDem.length
    ? await deps.elevations(
        needDem.map((s) => ({
          lat: s.peak.lat,
          lon: s.peak.lon,
          zoom: zoomForDistance(s.dist),
        })),
      )
    : new Float32Array(0);
  const dem = new Map(needDem.map((s, i) => [s.peak.id, values[i]!]));

  await prepareCrestLookup(scene);
  const ranked = rankPeaks(scene, visiblePeaks(scene, sightings, dem));
  return ranked.map((r) => ({ id: r.peak.id, name: r.peak.name, az: r.az, angle: r.angle }));
}
