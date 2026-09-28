import { describe, expect, it } from 'vitest';
import { DEFAULT_LINK_OPTIONS, linkRidges, type CrestTable, type PackedRidges } from './link';

/** Builds a crest table from per-ray lists of [dist, angle]. */
function table(rays: [number, number][][], azStep = 0.1, fullCircle = false): CrestTable {
  const offsets = new Uint32Array(rays.length + 1);
  const flat = rays.flat();
  let i = 0;
  rays.forEach((r, k) => {
    offsets[k] = i;
    i += r.length;
  });
  offsets[rays.length] = i;
  return {
    rayCount: rays.length,
    azStep,
    fullCircle,
    crestOffsets: offsets,
    crestDist: Float32Array.from(flat.map((c) => c[0])),
    crestAngle: Float32Array.from(flat.map((c) => c[1])),
    crestElev: Float32Array.from(flat.map(() => 1000)),
  };
}

function ridgeAz(p: PackedRidges): number[][] {
  const out: number[][] = [];
  for (let k = 0; k + 1 < p.offsets.length; k++) {
    out.push(
      Array.from(p.az.subarray(p.offsets[k], p.offsets[k + 1])).map((a) => Math.round(a * 10) / 10),
    );
  }
  return out;
}

const rays = (n: number, f: (r: number) => [number, number][]) =>
  Array.from({ length: n }, (_, r) => f(r));

describe('linkRidges', () => {
  it('links a continuous crest across rays', () => {
    const p = linkRidges(table(rays(10, (r) => [[10_000 + r * 50, 1 + r * 0.02]])));
    expect(p.offsets.length - 1).toBe(1);
    expect(ridgeAz(p)[0]).toEqual([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]);
  });

  it('splits on a distance jump of 6 % or more', () => {
    const p = linkRidges(table(rays(20, (r) => [[r < 10 ? 10_000 : 10_700, 1]])));
    expect(p.offsets.length - 1).toBe(2);
  });

  it('splits on an angle jump of 0.3° or more', () => {
    const p = linkRidges(table(rays(20, (r) => [[10_000, r < 10 ? 1 : 1.35]])));
    expect(p.offsets.length - 1).toBe(2);
  });

  it('drops ridgelines spanning less than 0.5°', () => {
    // 5 points span 0.4°, 6 points span 0.5°.
    const short = linkRidges(table(rays(5, () => [[10_000, 1]])));
    const enough = linkRidges(table(rays(6, () => [[10_000, 1]])));
    expect(short.offsets.length - 1).toBe(0);
    expect(enough.offsets.length - 1).toBe(1);
  });

  it('links each crest at most once, preferring the closest match', () => {
    const t = table(
      rays(8, (r) =>
        r === 4
          ? [
              [10_000, 1.0],
              [10_300, 1.1],
            ]
          : [[10_000, 1.0]],
      ),
    );
    const p = linkRidges(t, { ...DEFAULT_LINK_OPTIONS, minSpanDeg: 0 });
    const lengths = ridgeAz(p)
      .map((r) => r.length)
      .sort((a, b) => a - b);
    expect(lengths).toEqual([1, 8]);
  });

  it('joins ridgelines across the 0°/360° seam', () => {
    const t = table(
      rays(10, (r) => (r >= 8 || r <= 1 ? [[20_000, 2]] : [])),
      36,
      true,
    );
    const p = linkRidges(t, { ...DEFAULT_LINK_OPTIONS, minSpanDeg: 0 });
    expect(ridgeAz(p)).toEqual([[288, 324, 0, 36]]);
  });

  it('does not join across the seam when not a full circle', () => {
    const t = table(
      rays(10, (r) => (r >= 8 || r <= 1 ? [[20_000, 2]] : [])),
      36,
      false,
    );
    const p = linkRidges(t, { ...DEFAULT_LINK_OPTIONS, minSpanDeg: 0 });
    expect(p.offsets.length - 1).toBe(2);
  });
});
