import type { Peak } from './overpass';
import type { PeakCacheBackend } from './panoramaPeaks';

const DB_NAME = 'summit-sketch-peaks';
const STORE = 'panoramas';
/** OSM peaks change slowly; a month keeps the shared server load low. */
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;

interface StoredEntry {
  peaks: Peak[];
  savedAt: number;
}

const promisify = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return promisify(req);
}

/**
 * IndexedDB-backed cache. It is an optimization: storage can be blocked (private windows),
 * so failures are logged and treated as a miss instead of breaking the panorama.
 */
export function createIndexedDbPeakCache(): PeakCacheBackend {
  const db = openDb();
  return {
    async get(key) {
      try {
        const entry = (await promisify(
          (await db).transaction(STORE).objectStore(STORE).get(key),
        )) as StoredEntry | undefined;
        return entry && Date.now() - entry.savedAt < MAX_AGE_MS ? entry.peaks : undefined;
      } catch (err) {
        console.warn('Peak cache unavailable', err);
        return undefined;
      }
    },
    async set(key, peaks) {
      try {
        const entry: StoredEntry = { peaks, savedAt: Date.now() };
        await promisify(
          (await db).transaction(STORE, 'readwrite').objectStore(STORE).put(entry, key),
        );
      } catch (err) {
        console.warn('Peak cache write failed', err);
      }
    },
  };
}
