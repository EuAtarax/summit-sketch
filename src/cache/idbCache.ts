/** A small persistent key-value cache with an expiry, for results that are costly to fetch. */
export interface Cache<T> {
  get(key: string): Promise<T | undefined>;
  set(key: string, value: T): Promise<void>;
}

interface Stored<T> {
  value: T;
  savedAt: number;
}

const promisify = <R>(req: IDBRequest<R>) =>
  new Promise<R>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/**
 * IndexedDB-backed cache. It is an optimization: storage can be blocked (private windows,
 * some workers), so failures are logged and treated as a miss instead of breaking the caller.
 */
export function createIdbCache<T>(config: {
  dbName: string;
  store: string;
  maxAgeMs: number;
}): Cache<T> {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => {
    db ??= (() => {
      const req = indexedDB.open(config.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(config.store);
      return promisify(req);
    })();
    return db;
  };
  return {
    async get(key) {
      try {
        const entry = (await promisify(
          (await open()).transaction(config.store).objectStore(config.store).get(key),
        )) as Stored<T> | undefined;
        return entry && Date.now() - entry.savedAt < config.maxAgeMs ? entry.value : undefined;
      } catch (err) {
        console.warn(`Cache ${config.dbName} unavailable`, err);
        return undefined;
      }
    },
    async set(key, value) {
      try {
        const entry: Stored<T> = { value, savedAt: Date.now() };
        await promisify(
          (await open())
            .transaction(config.store, 'readwrite')
            .objectStore(config.store)
            .put(entry, key),
        );
      } catch (err) {
        console.warn(`Cache ${config.dbName} write failed`, err);
      }
    },
  };
}
