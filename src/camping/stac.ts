import type { FetchFn } from '../net/fetch';

export const STAC_ROOT = 'https://data.geo.admin.ch/api/stac/v0.9/collections';

interface StacAsset {
  href: string;
  type?: string;
  'eo:gsd'?: number;
}

export interface StacItem {
  id: string;
  assets: Record<string, StacAsset>;
}

/** The GeoTIFF of one 1 km tile at one resolution. */
export interface TileAsset {
  /** South-west corner in km, e.g. "2722-1204". */
  tileKey: string;
  year: number;
  href: string;
}

const ITEM_ID = /_(\d{4})_(\d{4}-\d{4})$/;

/**
 * For each 1 km tile, the GeoTIFF at the wanted resolution from the most recent survey year
 * (a STAC search returns every year that exists for a tile).
 */
export function latestTileAssets(items: readonly StacItem[], gsd: number): Map<string, TileAsset> {
  const best = new Map<string, TileAsset>();
  for (const item of items) {
    const match = ITEM_ID.exec(item.id);
    if (!match) continue;
    const asset = Object.values(item.assets).find(
      (a) => a.type?.includes('geotiff') && a['eo:gsd'] === gsd,
    );
    if (!asset) continue;
    const year = Number(match[1]);
    const tileKey = match[2]!;
    if (!best.has(tileKey) || best.get(tileKey)!.year < year) {
      best.set(tileKey, { tileKey, year, href: asset.href });
    }
  }
  return best;
}

interface StacPage {
  features?: StacItem[];
  links?: { rel: string; href: string }[];
}

const searches = new Map<string, Promise<Map<string, TileAsset>>>();

/**
 * Tile GeoTIFFs of a collection covering a WGS84 box (west, south, east, north), following
 * the search's pagination. Searches are cached for the session.
 */
export function fetchTileAssets(
  collection: string,
  bbox: readonly [number, number, number, number],
  gsd: number,
  fetchFn: FetchFn = (u, init) => fetch(u, init),
): Promise<Map<string, TileAsset>> {
  const first = `${STAC_ROOT}/${collection}/items?bbox=${bbox.map((v) => v.toFixed(4)).join(',')}&limit=100`;
  const key = `${first}|${gsd}`;
  let hit = searches.get(key);
  if (!hit) {
    hit = (async () => {
      const items: StacItem[] = [];
      let url: string | undefined = first;
      while (url) {
        const res = await fetchFn(url, {});
        if (!res.ok) throw new Error(`STAC search failed (HTTP ${res.status})`);
        const page = (await res.json()) as StacPage;
        items.push(...(page.features ?? []));
        url = page.links?.find((l) => l.rel === 'next')?.href;
      }
      return latestTileAssets(items, gsd);
    })();
    searches.set(key, hit);
    hit.catch(() => searches.delete(key));
  }
  return hit;
}
