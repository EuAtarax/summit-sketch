import { createIdbCache } from '../cache/idbCache';
import type { Peak } from './overpass';
import type { PeakCacheBackend } from './panoramaPeaks';

/** OSM peaks change slowly; a month keeps the shared server load low. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

export function createIndexedDbPeakCache(): PeakCacheBackend {
  return createIdbCache<Peak[]>({
    dbName: 'summit-sketch-peaks',
    store: 'panoramas',
    maxAgeMs: MAX_AGE_MS,
  });
}
