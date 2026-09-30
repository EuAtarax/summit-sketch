import type { Cache } from '../cache/idbCache';
import type { BBox } from '../geo/bbox';
import type { FetchFn } from '../net/fetch';
import { postOverpass } from '../peaks/overpassFetch';

export interface LatLon {
  lat: number;
  lon: number;
}

export type DrinkingKind = 'drinking_water' | 'water_point' | 'tap' | 'spring' | 'fountain';

export interface DrinkingSource extends LatLon {
  kind: DrinkingKind;
  name?: string;
}

/** What OpenStreetMap knows around a spot that matters for camping. */
export interface OsmFeatures {
  /** Paths, footways and tracks as polylines. */
  trails: LatLon[][];
  /** Streams, rivers, canals and lake outlines as polylines. */
  water: LatLon[][];
  /** Lakes, ponds and river areas as polygons (rings; holes are rings too, filled even-odd). */
  lakes: LatLon[][][];
  /** Places to fill a bottle. */
  drinking: DrinkingSource[];
}

/** Wording for the map popups: a spring is not automatically safe to drink from. */
export const DRINKING_LABELS: Record<DrinkingKind, string> = {
  drinking_water: 'Drinking water',
  water_point: 'Water point',
  tap: 'Water tap',
  fountain: 'Drinking fountain',
  spring: 'Spring (verify and treat before drinking)',
};

/** One query for everything: geometry included, so no second round trip is needed. */
export function featuresQuery(b: BBox): string {
  const box = `(${b.south.toFixed(5)},${b.west.toFixed(5)},${b.north.toFixed(5)},${b.east.toFixed(5)})`;
  return (
    `[out:json][timeout:30];(` +
    `way["highway"~"^(path|footway|track|bridleway|steps)$"]${box};` +
    `way["waterway"~"^(river|stream|canal)$"]${box};` +
    `way["natural"="water"]${box};` +
    `rel["natural"="water"]${box};` +
    `nwr["amenity"~"^(drinking_water|water_point)$"]${box};` +
    `nwr["natural"="spring"]${box};` +
    `nwr["man_made"="water_tap"]${box};` +
    `nwr["amenity"="fountain"]["drinking_water"="yes"]${box};` +
    `);out tags geom;`
  );
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  geometry?: LatLon[];
  members?: { role?: string; geometry?: LatLon[] }[];
}

const TRAIL_TYPES = new Set(['path', 'footway', 'track', 'bridleway', 'steps']);
const WATERWAY_TYPES = new Set(['river', 'stream', 'canal']);

function drinkingKind(t: Record<string, string>): DrinkingKind | null {
  if (t.drinking_water === 'no' || t.access === 'private') return null;
  if (t.amenity === 'drinking_water') return 'drinking_water';
  if (t.amenity === 'water_point') return 'water_point';
  if (t.man_made === 'water_tap') return 'tap';
  if (t.natural === 'spring') return 'spring';
  if (t.amenity === 'fountain' && t.drinking_water === 'yes') return 'fountain';
  return null;
}

/** All points of an element's geometry, whatever its type. */
function points(e: OverpassElement): LatLon[] {
  if (e.type === 'node')
    return e.lat === undefined || e.lon === undefined ? [] : [{ lat: e.lat, lon: e.lon }];
  if (e.geometry) return e.geometry;
  return (e.members ?? []).flatMap((m) => m.geometry ?? []);
}

const samePoint = (a: LatLon, b: LatLon) => a.lat === b.lat && a.lon === b.lon;
const isClosed = (line: readonly LatLon[]) =>
  line.length >= 4 && samePoint(line[0]!, line[line.length - 1]!);

/**
 * Joins the member ways of a multipolygon into closed rings. OSM splits long outlines into
 * several ways that share their end nodes; pieces that never close (cut off by the query or
 * broken in OSM) are dropped.
 */
export function stitchRings(parts: readonly (readonly LatLon[])[]): LatLon[][] {
  const rings: LatLon[][] = [];
  const open: LatLon[][] = [];
  for (const p of parts) {
    if (isClosed(p)) rings.push([...p]);
    else if (p.length >= 2) open.push([...p]);
  }
  while (open.length > 0) {
    let ring = open.pop()!;
    let grown = true;
    while (!isClosed(ring) && grown) {
      grown = false;
      const end = ring[ring.length - 1]!;
      for (let k = 0; k < open.length; k++) {
        const p = open[k]!;
        const next = samePoint(p[0]!, end)
          ? p
          : samePoint(p[p.length - 1]!, end)
            ? [...p].reverse()
            : null;
        if (!next) continue;
        ring = [...ring, ...next.slice(1)];
        open.splice(k, 1);
        grown = true;
        break;
      }
    }
    if (isClosed(ring)) rings.push(ring);
  }
  return rings;
}

/** Splits an Overpass answer into trails, water lines, lakes and drinking-water sources. */
export function parseFeatures(json: { elements?: OverpassElement[] }): OsmFeatures {
  const out: OsmFeatures = { trails: [], water: [], lakes: [], drinking: [] };
  for (const e of json.elements ?? []) {
    const t = e.tags ?? {};
    const kind = drinkingKind(t);
    if (kind) {
      const pts = points(e);
      if (pts.length === 0) continue;
      const lat = pts.reduce((s, p) => s + p.lat, 0) / pts.length;
      const lon = pts.reduce((s, p) => s + p.lon, 0) / pts.length;
      out.drinking.push({ lat, lon, kind, ...(t.name ? { name: t.name } : {}) });
    } else if (e.type === 'way' && e.geometry && t.highway && TRAIL_TYPES.has(t.highway)) {
      out.trails.push(e.geometry);
    } else if (
      e.type === 'way' &&
      e.geometry &&
      (t.natural === 'water' || WATERWAY_TYPES.has(t.waterway ?? ''))
    ) {
      out.water.push(e.geometry);
      if (t.natural === 'water' && isClosed(e.geometry)) out.lakes.push([e.geometry]);
    } else if (e.type === 'relation' && t.natural === 'water') {
      const parts = (e.members ?? []).flatMap((m) => (m.geometry ? [m.geometry] : []));
      out.water.push(...parts);
      const rings = stitchRings(parts);
      if (rings.length > 0) out.lakes.push(rings);
    }
  }
  return out;
}

/** Rounds a box outward to 0.005 degrees (about 500 m) so nearby spots share cached results. */
export function roundedBox(b: BBox): BBox {
  const step = 0.005;
  return {
    south: Math.floor(b.south / step) * step,
    west: Math.floor(b.west / step) * step,
    north: Math.ceil(b.north / step) * step,
    east: Math.ceil(b.east / step) * step,
  };
}

// "osm2": answers cached before lakes were parsed lack them, so they are not reused.
const cacheKey = (b: BBox) =>
  `osm2:${b.south.toFixed(3)},${b.west.toFixed(3)},${b.north.toFixed(3)},${b.east.toFixed(3)}`;

const inflight = new Map<string, Promise<OsmFeatures>>();

export interface FeatureFetchOptions {
  fetchFn?: FetchFn;
  backoffMs?: readonly number[];
  timeoutMs?: number;
  /** Persistent cache (IndexedDB in the browser). */
  cache?: Cache<OsmFeatures>;
}

/**
 * OSM features for a box: from the cache when present, otherwise one Overpass request with
 * the shared retry rules. Identical concurrent requests share one request.
 */
export function fetchFeatures(box: BBox, options: FeatureFetchOptions = {}): Promise<OsmFeatures> {
  const rounded = roundedBox(box);
  const key = cacheKey(rounded);
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      const cached = await options.cache?.get(key);
      if (cached) return cached;
      const json = await postOverpass(featuresQuery(rounded), {
        fetchFn: options.fetchFn ?? ((url, init) => fetch(url, init)),
        backoffMs: options.backoffMs ?? [2000, 5000],
        timeoutMs: options.timeoutMs ?? 40_000,
      });
      const features = parseFeatures(json as { elements?: OverpassElement[] });
      await options.cache?.set(key, features);
      return features;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
