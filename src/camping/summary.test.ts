import { describe, expect, it } from 'vitest';
import type { AnalysisResult } from './pipeline';
import {
  describeSpot,
  formatMeters,
  formatSignedMeters,
  protectedLayer,
  protectionAt,
  restrictionNotice,
} from './summary';

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

describe('formatSignedMeters', () => {
  it.each([
    [300, '+300 m'],
    [-1500, '-1500 m'],
    [0, 'Off'],
  ])('prints %d', (v, expected) => expect(formatSignedMeters(v)).toBe(expected));
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

describe('protectionAt and restrictionNotice', () => {
  it('finds the area under a position and nothing outside it or outside the box', () => {
    const res = result();
    expect(protectionAt(res, 15, 10)?.name).toBe('Chnuegrat'); // right half
    expect(protectionAt(res, 3, 10)).toBeNull(); // left half
    expect(protectionAt(res, 500, 10)).toBeNull(); // outside the box
    expect(protectionAt(without(res, 'protectionIndex'), 15, 10)).toBeNull();
  });

  it('warns without ever saying camping is allowed', () => {
    const text = restrictionNotice(result().areas[0]!);
    expect(text).toBe('In Wildlife quiet zone: Chnuegrat (not in force today). Check local rules.');
    expect(restrictionNotice({ ...result().areas[0]!, inForce: true })).toMatch(/in force today/);
  });
});
