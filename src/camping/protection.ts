import type { BBox } from '../peaks/overpass';
import type { FetchFn } from './cog';
import { wgs84ToLv95 } from './lv95';
import { fillPolygon, type Point, type Polygon } from './raster';
import type { GridGeometry } from './terrain';

const IDENTIFY_URL = 'https://api3.geo.admin.ch/rest/services/all/MapServer/identify';
const TIMEOUT_MS = 20_000;

/**
 * Federal protection layers that the identify service can return as polygons, with the
 * plain name shown to people. (The Swiss National Park comes with the parks layer,
 * category SNP; its own layer has no identify table.)
 */
export const PROTECTION_LAYERS: Record<string, string> = {
  'ch.bafu.wrz-wildruhezonen_portal': 'Wildlife quiet zone',
  'ch.bafu.bundesinventare-jagdbanngebiete': 'Game reserve',
  'ch.bafu.schutzgebiete-paerke_nationaler_bedeutung': 'Nature park',
  'ch.bafu.bundesinventare-vogelreservate': 'Bird reserve',
  'ch.bafu.bundesinventare-auen': 'Floodplain',
  'ch.bafu.bundesinventare-moorlandschaften': 'Moorland landscape',
  'ch.bafu.bundesinventare-hochmoore': 'Raised bog',
  'ch.bafu.bundesinventare-flachmoore': 'Fen',
};

export interface ProtectedArea {
  layer: string;
  /** What kind of area this is, e.g. "Wildlife quiet zone". */
  kind: string;
  name: string;
  /** Access rule as published (German), when the layer has one. */
  rule: string | null;
  /** Period in which the protection applies, e.g. "21.12. - 30.04.", or null for all year. */
  period: string | null;
  /** True if the protection applies on the date the areas were fetched for. */
  inForce: boolean;
  polygons: Polygon[];
}

interface IdentifyResult {
  layerBodId: string;
  geometry?: { type: string; coordinates: unknown };
  properties?: Record<string, unknown>;
  attributes?: Record<string, unknown>;
}

const PERIOD = /(\d{1,2})\.(\d{1,2})\.?\s*[-–]\s*(\d{1,2})\.(\d{1,2})\.?/;

/**
 * Whether a protection period like "21.12. - 30.04." covers a date. Periods may wrap the
 * year end. A missing or unreadable period counts as in force: better to flag than to miss.
 */
export function isInForce(period: string | null, date: Date): boolean {
  const m = period ? PERIOD.exec(period) : null;
  if (!m) return true;
  const [d1, m1, d2, m2] = m.slice(1).map(Number) as [number, number, number, number];
  const ordinal = (month: number, day: number) => month * 100 + day;
  const start = ordinal(m1, d1);
  const end = ordinal(m2, d2);
  const today = ordinal(date.getMonth() + 1, date.getDate());
  return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() && v.trim() !== 'None' ? v.trim() : null;
}

/** The layers publish names under different keys. */
function nameOf(a: Record<string, unknown>): string {
  return (
    text(a.label) ??
    text(a.gebietsname) ??
    text(a.name) ??
    text(a.wrz_name) ??
    text(a.objname) ??
    'Unnamed area'
  );
}

/** GeoJSON (lon, lat) polygons converted to LV95 rings. */
function toPolygons(geometry: NonNullable<IdentifyResult['geometry']>): Polygon[] {
  const ring = (r: unknown): Point[] =>
    (r as [number, number][]).map(([lon, lat]) => {
      const p = wgs84ToLv95(lat, lon);
      return [p.e, p.n] as const;
    });
  if (geometry.type === 'Polygon') return [(geometry.coordinates as unknown[]).map(ring)];
  if (geometry.type === 'MultiPolygon') {
    return (geometry.coordinates as unknown[][]).map((polygon) => polygon.map(ring));
  }
  return [];
}

/**
 * Turns an identify answer into protected areas. Lines (permitted paths inside wildlife
 * zones) are skipped. Areas whose protection is not in force on `date` come first, so
 * painting them in order lets the ones in force win where they overlap.
 */
export function parseProtectedAreas(
  json: { results?: IdentifyResult[] },
  date: Date,
): ProtectedArea[] {
  const areas: ProtectedArea[] = [];
  for (const r of json.results ?? []) {
    const kindBase = PROTECTION_LAYERS[r.layerBodId];
    if (!kindBase || !r.geometry) continue;
    const polygons = toPolygons(r.geometry);
    if (polygons.length === 0) continue;
    const a = r.properties ?? r.attributes ?? {};
    const period = text(a.schutzzeit);
    areas.push({
      layer: r.layerBodId,
      kind: text(a.kategorie) === 'SNP' ? 'Swiss National Park' : kindBase,
      name: nameOf(a),
      rule: text(a.best_de) ?? text(a.typ_de),
      period,
      inForce: isInForce(period, date),
      polygons,
    });
  }
  return areas.sort((x, y) => Number(x.inForce) - Number(y.inForce));
}

export function identifyUrl(box: BBox): string {
  const params = new URLSearchParams({
    geometryType: 'esriGeometryEnvelope',
    geometry: `${box.west},${box.south},${box.east},${box.north}`,
    geometryFormat: 'geojson',
    layers: `all:${Object.keys(PROTECTION_LAYERS).join(',')}`,
    tolerance: '0',
    sr: '4326',
    returnGeometry: 'true',
  });
  return `${IDENTIFY_URL}?${params}`;
}

/** Protected areas that touch a WGS84 box. Throws if the service cannot be reached. */
export async function fetchProtectedAreas(
  box: BBox,
  date: Date,
  fetchFn: FetchFn = (u, init) => fetch(u, init),
): Promise<ProtectedArea[]> {
  const res = await fetchFn(identifyUrl(box), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Protected-area service failed (HTTP ${res.status})`);
  return parseProtectedAreas((await res.json()) as { results?: IdentifyResult[] }, date);
}

/**
 * Per cell: 0 when no protected area covers it, otherwise the 1-based index into `areas` of
 * the area that covers it (one in force wins over one that is not).
 */
export function protectionIndex(areas: readonly ProtectedArea[], g: GridGeometry): Uint8Array {
  const index = new Uint8Array(g.width * g.height);
  // 255 is the most a byte can hold; a 4 km box never comes close to that many areas.
  areas.slice(0, 255).forEach((area, i) => {
    for (const polygon of area.polygons) fillPolygon(index, polygon, g, i + 1);
  });
  return index;
}
