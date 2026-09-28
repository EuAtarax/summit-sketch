/**
 * How many consecutive rays to merge into one vertex so vertices are at least minPx
 * apart. Always a divisor of rayCount, so buckets line up the same way in every tile and
 * across the 0°/360° seam.
 */
export function raysPerVertex(rayCount: number, pxPerRay: number, minPx: number): number {
  const want = Math.max(1, Math.floor(minPx / pxPerRay));
  for (let k = want; k > 1; k--) if (rayCount % k === 0) return k;
  return 1;
}

/**
 * Upper envelope of a per-ray line for rays [r0, r1] (unwrapped indices), merging k rays
 * per vertex and keeping the highest angle in each group, so peaks survive while
 * sub-pixel zigzag disappears. NaN rays break the line. Returns polylines of
 * [ray position (fractional index), angle].
 */
export function rayEnvelope(
  angleOf: (unwrappedRay: number) => number,
  r0: number,
  r1: number,
  k: number,
): [number, number][][] {
  const lines: [number, number][][] = [];
  let line: [number, number][] = [];
  for (let g = Math.floor(r0 / k); g * k <= r1; g++) {
    let max = -Infinity;
    for (let rr = g * k; rr < (g + 1) * k; rr++) {
      const a = angleOf(rr);
      if (a > max) max = a;
    }
    if (max === -Infinity) {
      if (line.length) lines.push(line);
      line = [];
      continue;
    }
    line.push([g * k + (k - 1) / 2, max]);
  }
  if (line.length) lines.push(line);
  return lines;
}
