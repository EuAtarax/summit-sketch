import { describe, expect, it } from 'vitest';
import { DEFAULT_SUITABILITY } from './analysis';
import {
  AREA_SIZES_KM,
  DEFAULT_SETTINGS,
  sanitizeSettings,
  sanitizeSuitability,
  SUITABILITY_CONTROLS,
  withPatch,
} from './settings';

describe('sanitizeSettings', () => {
  it('turns nothing, garbage or old data into the defaults', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('nope')).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings({ areaKm: 99, layer: 'x', palette: 'rainbow', opacity: 'a' })).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  it('keeps valid choices', () => {
    const s = sanitizeSettings({
      areaKm: 4,
      layer: 'slope',
      palette: 'magma',
      base: 'aerial',
      opacity: 0.4,
      overlays: ['trails', 7],
    });
    expect(s).toMatchObject({
      areaKm: 4,
      layer: 'slope',
      palette: 'magma',
      base: 'aerial',
      opacity: 0.4,
      overlays: ['trails'],
    });
  });

  it('only allows vegetation height on small areas', () => {
    expect(sanitizeSettings({ areaKm: 1, canopy: true }).canopy).toBe(true);
    expect(sanitizeSettings({ areaKm: 2, canopy: true }).canopy).toBe(false);
    expect(AREA_SIZES_KM).toContain(DEFAULT_SETTINGS.areaKm);
  });
});

describe('sanitizeSuitability', () => {
  it('returns the recommended defaults for missing values', () => {
    expect(sanitizeSuitability(undefined)).toEqual(DEFAULT_SUITABILITY);
  });

  it('clamps values into range', () => {
    const p = sanitizeSuitability({ slopeOkDeg: 99, roughMaxM: -1, patchRadiusCells: 9 });
    expect(p.slopeOkDeg).toBe(15);
    expect(p.roughMaxM).toBeGreaterThanOrEqual(0.1);
    expect(p.patchRadiusCells).toBe(3);
  });

  it('keeps the fade well-formed: the steepest slope stays above the comfortable one', () => {
    const p = sanitizeSuitability({ slopeOkDeg: 12, slopeMaxDeg: 5 });
    expect(p.slopeMaxDeg).toBeGreaterThan(p.slopeOkDeg);
  });

  it('keeps the water rule a boolean, on by default', () => {
    expect(sanitizeSuitability({}).excludeWater).toBe(true);
    expect(sanitizeSuitability({ excludeWater: false }).excludeWater).toBe(false);
    expect(sanitizeSuitability({ excludeWater: 'no' }).excludeWater).toBe(true);
  });
});

describe('SUITABILITY_CONTROLS', () => {
  it.each(SUITABILITY_CONTROLS.map((c) => [c.key, c] as const))(
    '%s has a recommended default inside its range and an explanation',
    (key, c) => {
      const value = DEFAULT_SUITABILITY[key];
      expect(value).toBeGreaterThanOrEqual(c.min);
      expect(value).toBeLessThanOrEqual(c.max);
      expect(c.help.length).toBeGreaterThan(30);
      expect(c.step).toBeGreaterThan(0);
    },
  );
});

describe('withPatch', () => {
  it('switches vegetation height off when the area grows beyond what it allows', () => {
    const small = { ...DEFAULT_SETTINGS, areaKm: 1 as const, canopy: true };
    expect(withPatch(small, { opacity: 0.5 }).canopy).toBe(true);
    expect(withPatch(small, { areaKm: 4 }).canopy).toBe(false);
    // ...and does not turn it back on by itself when the area shrinks again.
    expect(withPatch(withPatch(small, { areaKm: 4 }), { areaKm: 1 }).canopy).toBe(false);
  });

  it('refuses to turn vegetation height on for a large area', () => {
    expect(withPatch({ ...DEFAULT_SETTINGS, areaKm: 2 }, { canopy: true }).canopy).toBe(false);
  });

  it('applies ordinary changes unchanged', () => {
    expect(withPatch(DEFAULT_SETTINGS, { palette: 'magma' }).palette).toBe('magma');
  });
});
