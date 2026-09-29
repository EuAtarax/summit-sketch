import { mulberry32 } from './random';

let grain: HTMLCanvasElement | null | undefined;

/** A small tileable paper-grain texture (transparent speckles), generated once. */
export function paperGrain(): HTMLCanvasElement | null {
  if (grain !== undefined) return grain;
  if (typeof document === 'undefined') return (grain = null);
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  if (!ctx) return (grain = null);
  const img = ctx.createImageData(size, size);
  const rnd = mulberry32(0x5eed);
  for (let i = 0; i < size * size; i++) {
    const v = rnd();
    const dark = v < 0.5;
    img.data[i * 4] = dark ? 60 : 255;
    img.data[i * 4 + 1] = dark ? 55 : 255;
    img.data[i * 4 + 2] = dark ? 45 : 250;
    img.data[i * 4 + 3] = Math.round(Math.abs(v - 0.5) * 2 * 22);
  }
  ctx.putImageData(img, 0, 0);
  return (grain = c);
}
