import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './pipeline';
import { describeSpot, formatMeters, hiddenHectares, protectedLayer, summarize } from './summary';

/** A 10 x 10 cell result (2 m cells) with a protection on the right half. */
function result(overrides: Partial<AnalysisResult> = {}): AnalysisResult {
  const n = 100;
  const index = new Uint8Array(n);
  for (let row = 0; row < 10; row++) for (let col = 5; col < 10; col++) index[row * 10 + col] = 1;
  return {
    geometry: { e0: 0, n0: 20, cell: 2, width: 10, height: 10 },
    slope: new Float32Array(n).fill(4),
    roughness: new Float32Array(n),
    water: new Float32Array(n),
    trailDistance: new Float32Array(n).fill(120),
    waterDistance: new Float32Array(n).fill(Infinity),
    drinkingDistance: new Float32Array(n).fill(1450),
    drinking: [],
    protectionIndex: index,
    areas: [
      {
        layer: 'x',
        kind: 'Wildlife quiet zone',
        name: 'Chnuegrat',
        rule: null,
        period: '21.12. - 30.04.',
        inForce: false,
      },
    ],
    warnings: [],
    millis: 1500,
    ...overrides,
  };
}

/** A copy of a result without some optional data, as when a service was unreachable. */
function without(r: AnalysisResult, ...keys: (keyof AnalysisResult)[]): AnalysisResult {
  const kept = Object.entries(r).filter(([key]) => !keys.includes(key as keyof AnalysisResult));
  return Object.fromEntries(kept) as unknown as AnalysisResult;
}

describe('formatMeters', () => {
  it.each([
    [7, '10 m'],
    [124, '120 m'],
    [999, '1000 m'],
    [1450, '1.4 km'],
    [23_400, '23 km'],
  ])('formats %d m', (d, expected) => expect(formatMeters(d)).toBe(expected));
});

describe('describeSpot', () => {
  const spot = (col: number) => ({ rank: 2, col, row: 3, e: 0, n: 0, score: 0.864 });

  it('lists slope, distances and a protection that is not in force', () => {
    const item = describeSpot(result(), spot(7));
    expect(item.title).toBe('#2   score 86 %');
    expect(item.detail).toBe(
      '4° slope, 120 m from a trail, no water in this box, 1.4 km from drinking water, ' +
        'in Wildlife quiet zone: Chnuegrat (not in force today)',
    );
  });

  it('names nothing about a protection where there is none', () => {
    expect(describeSpot(result(), spot(1)).detail).not.toMatch(/in Wildlife/);
  });

  it('stays silent about distances that are unknown', () => {
    const noOsm = without(result(), 'trailDistance', 'waterDistance', 'drinkingDistance');
    expect(describeSpot(noOsm, spot(1)).detail).toBe('4° slope');
  });
});

describe('protectedLayer', () => {
  it('marks protection in force as 2 and out of season as 1', () => {
    const inForce = result({
      areas: [
        { layer: 'x', kind: 'Game reserve', name: 'A', rule: null, period: null, inForce: true },
      ],
    });
    expect(protectedLayer(inForce)![7]).toBe(2);
    expect(protectedLayer(result())![7]).toBe(1);
    expect(protectedLayer(result())![1]).toBe(0);
  });

  it('is null when the protection data is unavailable', () => {
    expect(protectedLayer(without(result(), 'protectionIndex'))).toBeNull();
  });
});

describe('hiddenHectares and summarize', () => {
  const inForceAreas = [
    { layer: 'x', kind: 'Game reserve', name: 'A', rule: null, period: null, inForce: true },
  ];

  it('counts good terrain under a protection that is in force', () => {
    const terrain = new Float32Array(100).fill(1);
    // 50 protected cells of 4 m2 = 200 m2 = 0.02 ha.
    expect(hiddenHectares(result({ areas: inForceAreas }), terrain)).toBeCloseTo(0.02, 6);
    expect(hiddenHectares(result(), terrain)).toBe(0); // out of season: nothing hidden
    expect(hiddenHectares(result({ areas: inForceAreas }), new Float32Array(100))).toBe(0);
  });

  it('summarizes size, time and share, and mentions hidden ground only when it matters', () => {
    const terrain = new Float32Array(100).fill(1);
    const score = new Float32Array(100);
    for (let i = 0; i < 25; i++) score[i] = 1;
    const text = summarize(result(), terrain, score, true);
    expect(text).toBe(
      '0.0 x 0.0 km in 1.5 s. 25.0 % of the area (0.0 ha) has ground you could pitch on.',
    );
    // Make the box big enough that hidden hectares reach 0.1 ha (cell = 20 m).
    const big = result({
      geometry: { e0: 0, n0: 200, cell: 20, width: 10, height: 10 },
      areas: inForceAreas,
    });
    expect(summarize(big, terrain, score, true)).toMatch(/hidden by protected areas/);
    expect(summarize(big, terrain, score, false)).not.toMatch(/hidden/);
  });
});
