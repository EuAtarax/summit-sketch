import { describe, expect, it } from 'vitest';
import { rayEnvelope, raysPerVertex } from './envelope';

describe('raysPerVertex', () => {
  it('merges enough rays to keep vertices minPx apart, as a divisor of the ray count', () => {
    expect(raysPerVertex(3600, 0.65, 2)).toBe(3);
    expect(raysPerVertex(3600, 0.3, 2)).toBe(6);
    expect(raysPerVertex(3600, 0.29, 2)).toBe(6); // 6.9 → 6 divides 3600
    expect(raysPerVertex(3600, 5, 2)).toBe(1);
    expect(raysPerVertex(7, 0.65, 2)).toBe(1); // wants 3, but only 1 and 7 divide 7
  });
});

describe('rayEnvelope', () => {
  const zigzag = (r: number) => (r % 2 === 0 ? 1 : 1.2);

  it('keeps every ray when k = 1', () => {
    expect(rayEnvelope(zigzag, 0, 3, 1)).toEqual([
      [
        [0, 1],
        [1, 1.2],
        [2, 1],
        [3, 1.2],
      ],
    ]);
  });

  it('takes the maximum per group, so zigzag flattens and peaks survive', () => {
    const peak = (r: number) => (r === 4 ? 5 : zigzag(r));
    expect(rayEnvelope(peak, 0, 5, 2)).toEqual([
      [
        [0.5, 1.2],
        [2.5, 1.2],
        [4.5, 5],
      ],
    ]);
  });

  it('groups by global ray index, including negative (wrapped) rays', () => {
    const line = rayEnvelope(() => 0, -3, 2, 3)[0]!;
    expect(line.map((p) => p[0])).toEqual([-2, 1]);
  });

  it('breaks the line where a whole group is NaN', () => {
    const gap = (r: number) => (r >= 2 && r < 4 ? NaN : 0);
    expect(rayEnvelope(gap, 0, 5, 2).map((l) => l.length)).toEqual([1, 1]);
  });
});
