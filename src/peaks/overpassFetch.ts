import { OVERPASS_URL, parsePeaks, peakQuery, type BBox, type Peak } from './overpass';

export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OverpassFetchOptions {
  fetchFn: FetchFn;
  /** Delay before each retry when the server is busy (429/503/504). Empty: no retries. */
  backoffMs: readonly number[];
  /** A hanging server must not block the caller forever. */
  timeoutMs: number;
}

/**
 * Runs the named-peak query for one or more boxes, retrying with backoff while the shared
 * public server is busy. Throws on any other failure or when the retries run out.
 * `onRequest` is called before every HTTP request (for request counting).
 */
export async function fetchPeaksFromOverpass(
  boxes: BBox | readonly BBox[],
  options: OverpassFetchOptions,
  onRequest?: () => void,
): Promise<Peak[]> {
  const body = new URLSearchParams({ data: peakQuery(boxes) });
  for (let attempt = 0; ; attempt++) {
    onRequest?.();
    const res = await options.fetchFn(OVERPASS_URL, {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (res.ok) return parsePeaks(await res.json());
    const busy = res.status === 429 || res.status === 504 || res.status === 503;
    const delay = options.backoffMs[attempt];
    if (!busy || delay === undefined) throw new Error(`Overpass HTTP ${res.status}`);
    await wait(delay);
  }
}
