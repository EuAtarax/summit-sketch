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
 * Sends one Overpass query and returns the parsed JSON, retrying with backoff while the shared
 * public server is busy. Throws on any other failure or when the retries run out.
 * `onRequest` is called before every HTTP request (for request counting).
 */
export async function postOverpass(
  query: string,
  options: OverpassFetchOptions,
  onRequest?: () => void,
): Promise<unknown> {
  const body = new URLSearchParams({ data: query });
  for (let attempt = 0; ; attempt++) {
    onRequest?.();
    const delay = options.backoffMs[attempt];
    let res: Response;
    try {
      res = await options.fetchFn(OVERPASS_URL, {
        method: 'POST',
        body,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (err) {
      // A busy Overpass server answers 429/504 without CORS headers, so the browser hides the
      // status and fetch fails with a TypeError. Treat that like a busy server. Timeouts and
      // aborts are not retried.
      if (!(err instanceof TypeError) || delay === undefined) throw err;
      await wait(delay);
      continue;
    }
    if (res.ok) return res.json();
    const busy = res.status === 429 || res.status === 504 || res.status === 503;
    if (!busy || delay === undefined) throw new Error(`Overpass HTTP ${res.status}`);
    await wait(delay);
  }
}

/** Runs the named-peak query for one or more boxes (see postOverpass for the retry rules). */
export async function fetchPeaksFromOverpass(
  boxes: BBox | readonly BBox[],
  options: OverpassFetchOptions,
  onRequest?: () => void,
): Promise<Peak[]> {
  return parsePeaks((await postOverpass(peakQuery(boxes), options, onRequest)) as never);
}
