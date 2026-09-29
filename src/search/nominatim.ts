export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
/** The public server allows at most one request per second. */
export const MIN_REQUEST_GAP_MS = 1100;
const RESULT_LIMIT = 6;
const TIMEOUT_MS = 8000;

export interface PlaceResult {
  id: number;
  /** Short name, e.g. "Zugspitze". */
  name: string;
  /** Full description, e.g. "Zugspitze, Garmisch-Partenkirchen, Bavaria, Germany". */
  description: string;
  lat: number;
  lon: number;
  /** Peaks and volcanoes are opened as summits; other places just center the map. */
  isPeak: boolean;
  /** Map zoom that frames the result. */
  zoom: number;
}

interface NominatimItem {
  place_id: number;
  lat: string;
  lon: string;
  name?: string;
  display_name: string;
  category?: string;
  type?: string;
  boundingbox?: [string, string, string, string]; // south, north, west, east
}

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export function buildSearchUrl(query: string, language: string): string {
  const params = new URLSearchParams({
    format: 'jsonv2',
    q: query,
    limit: String(RESULT_LIMIT),
    'accept-language': language,
    dedupe: '1',
  });
  return `${NOMINATIM_URL}?${params}`;
}

/** Map zoom at which a bounding box of the given size (degrees of longitude) fills a phone. */
export function zoomForSpan(lonSpanDeg: number): number {
  if (!(lonSpanDeg > 0)) return 14;
  const zoom = Math.floor(Math.log2(360 / lonSpanDeg)) + 1;
  return Math.min(15, Math.max(3, zoom));
}

export function parseResults(items: readonly NominatimItem[]): PlaceResult[] {
  return items.map((item) => {
    const isPeak = item.category === 'natural' && (item.type === 'peak' || item.type === 'volcano');
    const box = item.boundingbox?.map(Number);
    const lonSpan = box && box.length === 4 ? Math.abs(box[3]! - box[2]!) : 0;
    const description = item.display_name;
    return {
      id: item.place_id,
      name: item.name || description.split(',')[0]!.trim(),
      description,
      lat: Number(item.lat),
      lon: Number(item.lon),
      isPeak,
      zoom: isPeak ? 14 : zoomForSpan(lonSpan),
    };
  });
}

/**
 * Nominatim client that respects the usage policy: searches happen on submit only, requests
 * are spaced at least MIN_REQUEST_GAP_MS apart, identical queries are answered from memory,
 * and a newer search cancels the previous one.
 */
export class NominatimClient {
  private readonly cache = new Map<string, PlaceResult[]>();
  private lastRequestAt = 0;
  private current: AbortController | null = null;

  constructor(
    private readonly fetchFn: FetchFn = (url, init) => fetch(url, init),
    private readonly minGapMs = MIN_REQUEST_GAP_MS,
    private readonly language = navigator.language || 'en',
  ) {}

  async search(rawQuery: string): Promise<PlaceResult[]> {
    const query = rawQuery.trim().replace(/\s+/g, ' ');
    if (query.length < 2) return [];
    const key = query.toLowerCase();
    const hit = this.cache.get(key);
    if (hit) return hit;

    this.current?.abort();
    const controller = (this.current = new AbortController());
    const wait = this.lastRequestAt + this.minGapMs - Date.now();
    if (wait > 0) await sleep(wait, controller.signal);
    this.lastRequestAt = Date.now();

    const res = await this.fetchFn(buildSearchUrl(query, this.language), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(TIMEOUT_MS)]),
    });
    if (!res.ok) throw new Error(`Nominatim HTTP ${res.status}`);
    const results = parseResults((await res.json()) as NominatimItem[]);
    this.cache.set(key, results);
    return results;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
