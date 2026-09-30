import type { FetchFn } from '../../net/fetch';
import { AT_RULES } from './at';
import { CH_RULES } from './ch';
import type { RuleEntry, Stance } from './types';

export type { RuleEntry, RuleSource, Stance, Verification } from './types';

export const ALL_RULES: readonly RuleEntry[] = [...CH_RULES, ...AT_RULES];

/** Where a spot lies, as far as the rules care. */
export interface Place {
  country: string;
  /** Canton code ("OW") or ISO 3166-2 code ("AT-7"). */
  region?: string;
  regionName?: string;
  commune?: string;
}

/**
 * The entries that apply at a place, most specific first (commune, region, country): the
 * narrowest rule usually decides, so it is what people should read first.
 */
export function rulesFor(place: Place, rules: readonly RuleEntry[] = ALL_RULES): RuleEntry[] {
  const inCountry = rules.filter((r) => r.country === place.country);
  return [
    ...inCountry.filter(
      (r) =>
        r.level === 'commune' &&
        r.region === place.region &&
        place.commune !== undefined &&
        r.commune === place.commune,
    ),
    ...inCountry.filter((r) => r.level === 'region' && r.region === place.region),
    ...inCountry.filter((r) => r.level === 'country'),
  ];
}

/** Short wording of a stance for the panel. It describes the law, never a spot. */
export const STANCE_LABEL: Record<Stance, string> = {
  ban: 'General ban',
  permit: 'Needs a permit or the landowner’s consent',
  conditional: 'Permitted by law under conditions',
  local: 'No general rule at this level',
};

const IDENTIFY_URL = 'https://api3.geo.admin.ch/rest/services/all/MapServer/identify';
const CANTON_LAYER = 'ch.swisstopo.swissboundaries3d-kanton-flaeche.fill';
const COMMUNE_LAYER = 'ch.swisstopo.swissboundaries3d-gemeinde-flaeche.fill';

/**
 * Canton and commune at a point from geo.admin.ch. The commune layer keeps every year since
 * 1850, so the request asks for one year only (about 1 KB instead of 100).
 */
export function swissPlaceUrl(lat: number, lon: number, year: number): string {
  const params = new URLSearchParams({
    geometryType: 'esriGeometryPoint',
    geometry: `${lon},${lat}`,
    geometryFormat: 'geojson',
    layers: `all:${CANTON_LAYER},${COMMUNE_LAYER}`,
    timeInstant: String(year),
    tolerance: '0',
    sr: '4326',
    returnGeometry: 'false',
  });
  return `${IDENTIFY_URL}?${params}`;
}

interface IdentifyAnswer {
  results?: { layerBodId: string; properties?: Record<string, unknown> }[];
}

/** The canton and (the most recent) commune in an identify answer; null outside Switzerland. */
export function parseSwissPlace(json: IdentifyAnswer): Place | null {
  const results = json.results ?? [];
  const canton = results.find((r) => r.layerBodId === CANTON_LAYER)?.properties;
  if (typeof canton?.ak !== 'string') return null;
  const communes = results
    .filter((r) => r.layerBodId === COMMUNE_LAYER)
    .map((r) => r.properties ?? {})
    .filter((p) => typeof p.gemname === 'string')
    .sort((a, b) => Number(b.jahr ?? 0) - Number(a.jahr ?? 0));
  return {
    country: 'CH',
    region: canton.ak,
    ...(typeof canton.name === 'string' ? { regionName: canton.name } : {}),
    ...(communes[0] ? { commune: communes[0].gemname as string } : {}),
  };
}

/**
 * The Swiss place at a point, or null outside Switzerland. Early in a year the new year's
 * communes may not be published yet, so an answer without a commune is retried a year back.
 */
export async function lookupSwissPlace(
  lat: number,
  lon: number,
  fetchFn: FetchFn = (u, init) => fetch(u, init),
  now: Date = new Date(),
): Promise<Place | null> {
  const ask = async (year: number) => {
    const res = await fetchFn(swissPlaceUrl(lat, lon, year), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Place lookup failed (HTTP ${res.status})`);
    return parseSwissPlace((await res.json()) as IdentifyAnswer);
  };
  const year = now.getFullYear();
  const place = await ask(year);
  return place && !place.commune ? ((await ask(year - 1)) ?? place) : place;
}
