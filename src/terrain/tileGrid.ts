import { TILE_SIZE } from '../geo/tiles';

const SHIFT = 8; // log2(TILE_SIZE)
const MASK = TILE_SIZE - 1;

/**
 * A sparse set of decoded tiles at one zoom level, sampled in global pixel coordinates
 * (0..256·2^z). Pixel centers sit at +0.5. X wraps around the antimeridian; y clamps.
 */
export class TileGrid {
  readonly n: number;
  readonly size: number;
  private readonly tiles = new Map<number, Float32Array>();
  private lastKey = -1;
  private lastTile: Float32Array | undefined;

  constructor(readonly z: number) {
    this.n = 2 ** z;
    this.size = this.n * TILE_SIZE;
  }

  get tileCount(): number {
    return this.tiles.size;
  }

  set(x: number, y: number, elev: Float32Array): void {
    this.tiles.set(y * this.n + x, elev);
    this.lastKey = -1;
  }

  has(x: number, y: number): boolean {
    return this.tiles.has(y * this.n + x);
  }

  private tile(tx: number, ty: number): Float32Array | undefined {
    const key = ty * this.n + tx;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.lastTile = this.tiles.get(key);
    }
    return this.lastTile;
  }

  /** Elevation of one integer global pixel; NaN if its tile isn't loaded. */
  pixel(px: number, py: number): number {
    const size = this.size;
    const x = ((px % size) + size) % size;
    const y = py < 0 ? 0 : py >= size ? size - 1 : py;
    const t = this.tile(x >> SHIFT, y >> SHIFT);
    return t ? t[((y & MASK) << SHIFT) | (x & MASK)]! : NaN;
  }

  /** Bilinear sample at fractional global pixel coords; NaN if a needed tile isn't loaded. */
  sample(gx: number, gy: number): number {
    const fx = gx - 0.5;
    const fy = gy - 0.5;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const size = this.size;
    const ix = ((x0 % size) + size) % size;
    const iy = y0 < 0 ? 0 : y0 > size - 2 ? size - 2 : y0;
    const lx = ix & MASK;
    const ly = iy & MASK;
    let a: number, b: number, c: number, d: number;
    if (lx < MASK && ly < MASK) {
      // Fast path: all four neighbors are in the same tile.
      const t = this.tile(ix >> SHIFT, iy >> SHIFT);
      if (!t) return NaN;
      const i = (ly << SHIFT) | lx;
      a = t[i]!;
      b = t[i + 1]!;
      c = t[i + TILE_SIZE]!;
      d = t[i + TILE_SIZE + 1]!;
    } else {
      a = this.pixel(ix, iy);
      b = this.pixel(ix + 1, iy);
      c = this.pixel(ix, iy + 1);
      d = this.pixel(ix + 1, iy + 1);
    }
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }
}

/** Tiles at zoom z overlapping the global-pixel box (inclusive), with x wrapped. */
export function tilesInBox(
  z: number,
  gx0: number,
  gy0: number,
  gx1: number,
  gy1: number,
): { x: number; y: number }[] {
  const n = 2 ** z;
  const out: { x: number; y: number }[] = [];
  const ty0 = Math.max(0, Math.floor(gy0 / TILE_SIZE));
  const ty1 = Math.min(n - 1, Math.floor(gy1 / TILE_SIZE));
  const tx0 = Math.floor(gx0 / TILE_SIZE);
  const tx1 = Math.floor(gx1 / TILE_SIZE);
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) out.push({ x: ((tx % n) + n) % n, y: ty });
  }
  return out;
}
