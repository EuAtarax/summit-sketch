// Pure helpers of the proxy: byte ranges and fixed-size blocks, so cached pieces of a large
// file can be reused by any later request that overlaps them.

/** Cached pieces are 1 MiB: a few COG tiles each, and few enough requests per file. */
export const BLOCK = 1 << 20;

/**
 * Parses a single, closed byte range ("bytes=100-199"). Open ranges ("bytes=100-"), suffix
 * ranges and multiple ranges are not supported (the app never sends them): null.
 * @param {string | null} header
 * @returns {{ start: number, end: number } | null}
 */
export function parseRange(header) {
  const m = /^bytes=(\d+)-(\d+)$/.exec((header ?? '').trim());
  if (!m) return null;
  const start = Number(m[1]);
  const end = Number(m[2]);
  return end >= start ? { start, end } : null;
}

/**
 * Indexes of the blocks a byte range touches.
 * @param {number} start
 * @param {number} end inclusive
 * @returns {number[]}
 */
export function blocksFor(start, end) {
  const out = [];
  for (let k = Math.floor(start / BLOCK); k <= Math.floor(end / BLOCK); k++) out.push(k);
  return out;
}

/**
 * The bytes [start, end] cut out of consecutive blocks (the first one has index `first`).
 * @param {Uint8Array[]} blocks
 * @param {number} first
 * @param {number} start
 * @param {number} end inclusive
 * @returns {Uint8Array}
 */
export function sliceBlocks(blocks, first, start, end) {
  const out = new Uint8Array(end - start + 1);
  let written = 0;
  blocks.forEach((bytes, i) => {
    const blockStart = (first + i) * BLOCK;
    const from = Math.max(start, blockStart) - blockStart;
    const to = Math.min(end + 1, blockStart + bytes.length) - blockStart;
    if (to > from) {
      out.set(bytes.subarray(from, to), written);
      written += to - from;
    }
  });
  return out.subarray(0, written);
}
