import type { GridGeometry } from './terrain';

/** A position in LV95 as [easting, northing], meters. */
export type Point = readonly [number, number];
/** A polygon as rings: the outer ring first, holes after it. */
export type Polygon = readonly (readonly Point[])[];

/** Column and row of the cell containing a point, or null outside the grid. */
function cellOf(g: GridGeometry, e: number, n: number): number | null {
  const col = Math.floor((e - g.e0) / g.cell);
  const row = Math.floor((g.n0 - n) / g.cell);
  return col < 0 || row < 0 || col >= g.width || row >= g.height ? null : row * g.width + col;
}

/** Marks (1) the cells touched by polylines, sampling every half cell along each segment. */
export function rasterizeLines(lines: readonly (readonly Point[])[], g: GridGeometry): Uint8Array {
  const mask = new Uint8Array(g.width * g.height);
  const step = g.cell / 2;
  for (const line of lines) {
    for (let i = 0; i + 1 < line.length; i++) {
      const [e1, n1] = line[i]!;
      const [e2, n2] = line[i + 1]!;
      const samples = Math.max(1, Math.ceil(Math.hypot(e2 - e1, n2 - n1) / step));
      for (let s = 0; s <= samples; s++) {
        const t = s / samples;
        const at = cellOf(g, e1 + (e2 - e1) * t, n1 + (n2 - n1) * t);
        if (at !== null) mask[at] = 1;
      }
    }
    if (line.length === 1) {
      const at = cellOf(g, line[0]![0], line[0]![1]);
      if (at !== null) mask[at] = 1;
    }
  }
  return mask;
}

/** Marks (1) the cells that contain a point. */
export function rasterizePoints(points: readonly Point[], g: GridGeometry): Uint8Array {
  const mask = new Uint8Array(g.width * g.height);
  for (const [e, n] of points) {
    const at = cellOf(g, e, n);
    if (at !== null) mask[at] = 1;
  }
  return mask;
}

/**
 * Fills the cells whose centers lie inside a polygon (even-odd rule, so holes work) with
 * `value`, overwriting what is there. One scanline per grid row.
 */
export function fillPolygon(
  target: Uint8Array,
  polygon: Polygon,
  g: GridGeometry,
  value: number,
): void {
  let minN = Infinity;
  let maxN = -Infinity;
  for (const ring of polygon) {
    for (const [, n] of ring) {
      minN = Math.min(minN, n);
      maxN = Math.max(maxN, n);
    }
  }
  const rowA = Math.max(0, Math.floor((g.n0 - maxN) / g.cell));
  const rowB = Math.min(g.height - 1, Math.ceil((g.n0 - minN) / g.cell));
  for (let row = rowA; row <= rowB; row++) {
    const n = g.n0 - (row + 0.5) * g.cell;
    const crossings: number[] = [];
    for (const ring of polygon) {
      for (let i = 0; i < ring.length; i++) {
        const [e1, n1] = ring[i]!;
        const [e2, n2] = ring[(i + 1) % ring.length]!;
        if (n1 <= n !== n2 <= n) crossings.push(e1 + ((n - n1) * (e2 - e1)) / (n2 - n1));
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      const colA = Math.max(0, Math.ceil((crossings[k]! - g.e0) / g.cell - 0.5));
      const colB = Math.min(g.width - 1, Math.floor((crossings[k + 1]! - g.e0) / g.cell - 0.5));
      for (let col = colA; col <= colB; col++) target[row * g.width + col] = value;
    }
  }
}

const FAR = 1e20;

/**
 * One dimension of the exact squared Euclidean distance transform (Felzenszwalb and
 * Huttenlocher): the lower envelope of parabolas rooted at every position.
 */
function transform1d(
  f: Float64Array,
  n: number,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
): void {
  const crossing = (q: number, p: number) => (f[q]! + q * q - (f[p]! + p * p)) / (2 * q - 2 * p);
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = crossing(q, v[k]!);
    while (s <= z[k]!) {
      k--;
      s = crossing(q, v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    const p = v[k]!;
    d[q] = (q - p) * (q - p) + f[p]!;
  }
}

/**
 * Distance in meters from each cell to the nearest marked cell (exact Euclidean, in cell
 * units times the cell size). Infinity everywhere when nothing is marked.
 */
export function distanceTransform(
  mask: Uint8Array,
  width: number,
  height: number,
  cell: number,
): Float32Array {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = mask[i] ? 0 : FAR;
  const size = Math.max(width, height);
  const f = new Float64Array(size);
  const d = new Float64Array(size);
  const v = new Int32Array(size);
  const z = new Float64Array(size + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    transform1d(f, height, d, v, z);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!;
    transform1d(f, width, d, v, z);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]!;
  }
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++)
    out[i] = grid[i]! >= FAR ? Infinity : Math.sqrt(grid[i]!) * cell;
  return out;
}

/** The same grid grown by `cells` on every side (same cell size, cells stay aligned). */
export function padGeometry(g: GridGeometry, cells: number): GridGeometry {
  return {
    e0: g.e0 - cells * g.cell,
    n0: g.n0 + cells * g.cell,
    cell: g.cell,
    width: g.width + 2 * cells,
    height: g.height + 2 * cells,
  };
}

/**
 * Distance in meters from each cell of `g` to the nearest feature. `mark` rasterizes the
 * features onto `g` grown by `padCells`, so a trail or spring just outside the window still
 * counts for the cells along its edge; the result is cropped back to `g`.
 */
export function distanceMap(
  mark: (grid: GridGeometry) => Uint8Array,
  g: GridGeometry,
  padCells: number,
): Float32Array {
  const padded = padGeometry(g, padCells);
  const full = distanceTransform(mark(padded), padded.width, padded.height, g.cell);
  const out = new Float32Array(g.width * g.height);
  for (let row = 0; row < g.height; row++) {
    const from = (row + padCells) * padded.width + padCells;
    out.set(full.subarray(from, from + g.width), row * g.width);
  }
  return out;
}
