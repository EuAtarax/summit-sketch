import { describe, expect, it } from 'vitest';
import { LAYERS, sampleRamp } from './heatmap';

describe('sampleRamp', () => {
  const stops = [
    { at: 0, color: [0, 0, 0, 0] },
    { at: 10, color: [100, 200, 50, 200] },
  ] as const;

  it('interpolates between stops and clamps outside them', () => {
    expect(sampleRamp(stops, 5)).toEqual([50, 100, 25, 100]);
    expect(sampleRamp(stops, -3)).toEqual([0, 0, 0, 0]);
    expect(sampleRamp(stops, 99)).toEqual([100, 200, 50, 200]);
  });

  it('is transparent for missing data', () => {
    expect(sampleRamp(stops, Number.NaN)).toEqual([0, 0, 0, 0]);
  });
});

describe('layer ramps', () => {
  it.each(Object.entries(LAYERS))('%s has increasing stops within its range', (_id, layer) => {
    const positions = layer.stops.map((s) => s.at);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(positions[positions.length - 1]!).toBeGreaterThanOrEqual(layer.max * 0.9);
  });

  it('hides unsuitable cells and shows suitable ones on the suitability layer', () => {
    expect(sampleRamp(LAYERS.suitability.stops, 0)[3]).toBe(0);
    expect(sampleRamp(LAYERS.suitability.stops, 1)[3]).toBeGreaterThan(150);
  });
});
