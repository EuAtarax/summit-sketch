// Cloudflare Worker that lets the camping finder read Austria's open elevation data.
//
// data.bev.gv.at serves the 1 m ALS terrain and surface models as cloud-optimized GeoTIFFs and
// answers range requests, but sends no Access-Control-Allow-Origin header, so a browser page on
// another site may not read the answers. This worker fetches the same bytes and adds the header.
// It only forwards range requests for the ALS files, and only for the app's own origins.
//
// Optional: with an R2 bucket bound as CACHE, every 1 MiB block fetched from the BEV is kept in
// R2 and served from there afterwards (a copy that fills itself as people use the app). The
// Cloudflare cache is not available on *.workers.dev, which is why R2 is used for this.
//
// Data: BEV, CC BY 4.0 ("Datenquelle: BEV - Bundesamt für Eich- und Vermessungswesen").

import { BLOCK, blocksFor, parseRange, sliceBlocks } from './blocks.js';

const UPSTREAM = 'https://data.bev.gv.at/download/';
/** Only the ALS terrain (DTM) and surface (DSM) GeoTIFFs, e.g. ALS/DTM/20240915/ALS_DTM_....tif */
const ALLOWED_PATH = /^ALS\/(DTM|DSM)\/[\w.-]+\/[\w.-]+\.tif$/;
/** The largest range one request may ask for (a COG header or a few tiles). */
const MAX_RANGE = 4 * BLOCK;

/**
 * @param {string | null} origin
 * @param {string} allowed comma-separated list from the ALLOWED_ORIGINS variable
 */
function corsHeaders(origin, allowed) {
  const list = allowed.split(',').map((s) => s.trim());
  return origin && list.includes(origin)
    ? {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, ETag',
        Vary: 'Origin',
      }
    : {};
}

/**
 * @param {number} status
 * @param {string} message
 * @param {Record<string, string>} headers
 */
const text = (status, message, headers) =>
  new Response(message, { status, headers: { ...headers, 'Content-Type': 'text/plain' } });

/**
 * A byte range from the BEV. One retry: a single dropped answer would otherwise fail the whole
 * analysis in the app.
 * @returns {Promise<Response>}
 */
async function upstream(path, start, end) {
  const ask = () => fetch(UPSTREAM + path, { headers: { Range: `bytes=${start}-${end}` } });
  const first = await ask().catch(() => null);
  if (first?.status === 206) return first;
  return ask();
}

/**
 * One 1 MiB block of a file, from R2 when present, else from the BEV (and then kept in R2).
 * @returns {Promise<{ bytes: Uint8Array, total: number } | null>}
 */
async function block(env, ctx, path, index) {
  const key = `${path}/${index}`;
  const cached = await env.CACHE.get(key);
  if (cached) {
    return {
      bytes: new Uint8Array(await cached.arrayBuffer()),
      total: Number(cached.customMetadata?.total),
    };
  }
  const res = await upstream(path, index * BLOCK, (index + 1) * BLOCK - 1);
  if (res.status !== 206) return null;
  const total = Number(/\/(\d+)$/.exec(res.headers.get('Content-Range') ?? '')?.[1]);
  if (!Number.isFinite(total)) return null;
  const bytes = new Uint8Array(await res.arrayBuffer());
  ctx.waitUntil(env.CACHE.put(key, bytes, { customMetadata: { total: String(total) } }));
  return { bytes, total };
}

/** The range from the BEV directly (no R2 bound): the bytes asked for, nothing more. */
async function passThrough(path, range, cors) {
  const res = await upstream(path, range.start, range.end);
  if (res.status !== 206) return text(502, `The BEV server answered ${res.status}.`, cors);
  return new Response(res.body, {
    status: 206,
    headers: {
      ...cors,
      'Content-Type': 'image/tiff',
      'Content-Range': res.headers.get('Content-Range') ?? '',
      'Cache-Control': 'public, max-age=86400',
    },
  });
}

export default {
  /**
   * @param {Request} request
   * @param {{ ALLOWED_ORIGINS: string, CACHE?: any }} env
   * @param {{ waitUntil(p: Promise<unknown>): void }} ctx
   */
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request.headers.get('Origin'), env.ALLOWED_ORIGINS);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          ...cors,
          'Access-Control-Allow-Methods': 'GET',
          'Access-Control-Allow-Headers': 'Range',
          'Access-Control-Max-Age': '86400',
        },
      });
    }
    if (request.method !== 'GET') return text(405, 'Only GET.', cors);

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/bev\//, '');
    if (!url.pathname.startsWith('/bev/') || !ALLOWED_PATH.test(path)) {
      return text(404, 'Only /bev/ALS/DTM/... and /bev/ALS/DSM/... GeoTIFFs are proxied.', cors);
    }
    const range = parseRange(request.headers.get('Range'));
    if (!range || range.end - range.start + 1 > MAX_RANGE) {
      return text(416, `Send one closed byte range of at most ${MAX_RANGE} bytes.`, cors);
    }
    if (!env.CACHE) return passThrough(path, range, cors);

    const indexes = blocksFor(range.start, range.end);
    const parts = [];
    let total = 0;
    for (const index of indexes) {
      const b = await block(env, ctx, path, index);
      if (!b) return text(502, 'The BEV server did not answer the range.', cors);
      parts.push(b.bytes);
      total = b.total;
    }
    const end = Math.min(range.end, total - 1);
    if (range.start > end) return text(416, 'Range beyond the end of the file.', cors);
    return new Response(sliceBlocks(parts, indexes[0], range.start, end), {
      status: 206,
      headers: {
        ...cors,
        'Content-Type': 'image/tiff',
        'Content-Range': `bytes ${range.start}-${end}/${total}`,
        'Cache-Control': 'public, max-age=86400',
      },
    });
  },
};
