import type { GridGeometry } from './terrain';

/** A georeferenced block of pixels, row-major from the north, in the grid's coordinates. */
export interface PixelBlock {
  data: Float32Array;
  width: number;
  height: number;
  /** Top-left corner of the top-left pixel. */
  originX: number;
  originY: number;
  pixelSize: number;
}

/**
 * Fills the NaN entries of `out`, a raster of the grid subdivided `factor` times per cell side
 * ((width * factor) x (height * factor) values), by sampling `block` at each sub-cell center.
 * Terrain is sampled bilinearly (smooth ground stays smooth); a surface model is sampled at
 * the nearest pixel, so a tree top keeps its height. Sub-cells outside the block stay NaN, so
 * several blocks (neighbouring source tiles) can fill one raster in turn.
 */
export function sampleInto(
  block: PixelBlock,
  out: Float32Array,
  g: GridGeometry,
  factor: number,
  method: 'bilinear' | 'nearest',
): void {
  const step = g.cell / factor;
  const w = g.width * factor;
  const h = g.height * factor;
  const at = (x: number, y: number) => block.data[y * block.width + x]!;
  for (let row = 0; row < h; row++) {
    const n = g.n0 - (row + 0.5) * step;
    const py = (block.originY - n) / block.pixelSize - 0.5;
    if (py < -0.5 || py > block.height - 0.5) continue;
    for (let col = 0; col < w; col++) {
      const i = row * w + col;
      if (!Number.isNaN(out[i]!)) continue;
      const e = g.e0 + (col + 0.5) * step;
      const px = (e - block.originX) / block.pixelSize - 0.5;
      if (px < -0.5 || px > block.width - 0.5) continue;
      const nx = Math.min(block.width - 1, Math.max(0, Math.round(px)));
      const ny = Math.min(block.height - 1, Math.max(0, Math.round(py)));
      if (method === 'nearest') {
        out[i] = at(nx, ny);
        continue;
      }
      const x0 = Math.min(block.width - 2, Math.max(0, Math.floor(px)));
      const y0 = Math.min(block.height - 2, Math.max(0, Math.floor(py)));
      const fx = Math.min(1, Math.max(0, px - x0));
      const fy = Math.min(1, Math.max(0, py - y0));
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      const v = (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
      // Next to a gap the bilinear mix is NaN: fall back to the nearest pixel.
      out[i] = Number.isNaN(v) ? at(nx, ny) : v;
    }
  }
}
