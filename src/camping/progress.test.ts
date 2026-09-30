import { describe, expect, it } from 'vitest';
import { progressFraction, shortStage } from './progress';

describe('progressFraction', () => {
  it('rises with the terrain tiles and never goes backwards through the stages', () => {
    const at = (stage: 'terrain' | 'analysis' | 'surface' | 'features', done = 0, total = 1) =>
      progressFraction({ stage, done, total });
    expect(at('terrain', 0, 10)).toBeCloseTo(0.05, 6);
    expect(at('terrain', 5, 10)).toBeCloseTo(0.35, 6);
    expect(at('terrain', 10, 10)).toBeCloseTo(0.65, 6);
    expect(at('analysis')).toBe(0.7);
    expect(at('surface', 1, 2)).toBeCloseTo(0.775, 6);
  });

  it('is indeterminate while waiting for the services and safe without a total', () => {
    expect(progressFraction({ stage: 'features', done: 0, total: 1 })).toBeNull();
    expect(progressFraction({ stage: 'terrain', done: 0, total: 0 })).toBeCloseTo(0.05, 6);
    expect(progressFraction({ stage: 'terrain', done: 9, total: 3 })).toBeCloseTo(0.65, 6);
  });
});

describe('shortStage', () => {
  it('says each stage in a few words, with tile counts while loading', () => {
    expect(shortStage({ stage: 'terrain', done: 3, total: 9 })).toBe('Loading terrain 3/9');
    expect(shortStage({ stage: 'surface', done: 1, total: 16 })).toBe('Loading vegetation 1/16');
    expect(shortStage({ stage: 'analysis', done: 0, total: 1 })).toBe('Analysing');
    expect(shortStage({ stage: 'features', done: 0, total: 1 })).toBe(
      'Trails, water, protected areas',
    );
  });
});
