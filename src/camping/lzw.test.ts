/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodeLzw } from './lzw';
import { encodeLzw } from './testTiff';

describe('decodeLzw', () => {
  it('round-trips short and long inputs, crossing every code width', () => {
    const inputs: Uint8Array[] = [
      Uint8Array.from([]),
      Uint8Array.from([7, 7, 7, 8, 8, 7, 7, 6, 6]),
      Uint8Array.from({ length: 5000 }, (_, i) => (i * 7 + (i >> 5)) & 0xff),
      // Random-looking data fills the table fast (9 -> 12 bits and table resets).
      Uint8Array.from({ length: 60_000 }, (_, i) => Math.imul(i, 2654435761) >>> 24),
      new Uint8Array(30_000), // long runs: exercises the "code being defined" case
    ];
    for (const data of inputs) {
      const decoded = decodeLzw(encodeLzw(data), data.length);
      expect(Array.from(decoded)).toEqual(Array.from(data));
    }
  });

  it('cuts the output at the requested length', () => {
    const data = Uint8Array.from({ length: 1000 }, (_, i) => i % 13);
    expect(Array.from(decodeLzw(encodeLzw(data), 400))).toEqual(Array.from(data.slice(0, 400)));
  });

  it('decodes a real swissALTI3D tile into a smooth alpine surface', () => {
    // 128 x 128 float32 tile (Glarus Sud) cut out of the published Cloud-Optimized GeoTIFF.
    const compressed = new Uint8Array(
      readFileSync(new URL('./fixtures/swissalti3d-2m-tile.lzw', import.meta.url)),
    );
    const raw = decodeLzw(compressed, 128 * 128 * 4);
    const z = new Float32Array(raw.buffer, raw.byteOffset, 128 * 128);
    let min = Infinity;
    let max = -Infinity;
    let maxStep = 0;
    for (let y = 0; y < 128; y++) {
      for (let x = 0; x < 128; x++) {
        const v = z[y * 128 + x]!;
        min = Math.min(min, v);
        max = Math.max(max, v);
        if (x > 0) maxStep = Math.max(maxStep, Math.abs(v - z[y * 128 + x - 1]!));
        if (y > 0) maxStep = Math.max(maxStep, Math.abs(v - z[(y - 1) * 128 + x]!));
      }
    }
    // Alpine elevations, and no jumps of more than a cliff between 2 m neighbours. A wrong
    // decode produces noise, which would break both.
    expect(min).toBeGreaterThan(500);
    expect(max).toBeLessThan(4200);
    expect(maxStep).toBeLessThan(12);
    expect(max - min).toBeGreaterThan(5);
  });
});
