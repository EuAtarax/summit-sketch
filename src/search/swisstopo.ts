import type { PlaceResult } from './nominatim';

export const SEARCH_SERVER_URL = 'https://api3.geo.admin.ch/rest/services/api/SearchServer';
const RESULT_LIMIT = 6;
const TIMEOUT_MS = 6000;
/** Swiss place-name index levels of detail up to here are towns and regions, not points. */
const REGION_ZOOMLEVEL = 9;

interface SearchServerItem {
  id: number;
  attrs: { label: string; lat: number; lon: number; zoomlevel?: number };
}

export function buildSuggestUrl(query: string, language: string): string {
  const params = new URLSearchParams({
    searchText: query,
    type: 'locations',
    origins: 'gazetteer,zipcode',
    limit: String(RESULT_LIMIT),
    lang: language,
  });
  return `${SEARCH_SERVER_URL}?${params}`;
}

const stripTags = (html: string): string => html.replace(/<[^>]*>/g, '').trim();

/**
 * Turns SearchServer items into places. Labels look like
 * `<i>Alpin peak</i> <b>Pilatus</b> (OW,NW,LU) - Hergiswil`: the bold part is the name (bilingual
 * names are joined by "|"), the italic part is the kind of feature.
 */
export function parseSuggestions(items: readonly SearchServerItem[]): PlaceResult[] {
  return items.map((item) => {
    const { label, lat, lon, zoomlevel = 10 } = item.attrs;
    const kind = /<i>([\s\S]*?)<\/i>/.exec(label)?.[1] ?? '';
    const boldName = /<b>([\s\S]*?)<\/b>/.exec(label)?.[1] ?? label;
    const name = stripTags(boldName).split('|')[0]!.replace(/\s+/g, ' ').trim();
    const after = stripTags(label.split('</b>')[1] ?? '').replace(/\s+/g, ' ');
    return {
      id: item.id,
      name,
      description: [stripTags(kind), after].filter(Boolean).join(' '),
      lat,
      lon,
      isPeak: /peak|gipfel|cime|pizzo/i.test(kind),
      zoom: zoomlevel <= REGION_ZOOMLEVEL ? 12 : 14,
    };
  });
}

/**
 * Type-ahead suggestions for Swiss place names from swisstopo's public SearchServer (CORS-open,
 * free). Matching is by word prefix, so it needs the real spelling (with umlauts). Unlike
 * Nominatim it may be queried while typing; callers still debounce and cancel stale requests.
 */
export class SwisstopoSuggester {
  private readonly cache = new Map<string, PlaceResult[]>();

  constructor(private readonly language = (navigator.language || 'en').slice(0, 2)) {}

  async suggest(rawQuery: string, signal?: AbortSignal): Promise<PlaceResult[]> {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    const key = query.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const res = await fetch(buildSuggestUrl(query, this.language), {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!res.ok) throw new Error(`SearchServer HTTP ${res.status}`);
    const found = parseSuggestions(((await res.json()) as { results: SearchServerItem[] }).results);
    this.cache.set(key, found);
    return found;
  }
}
