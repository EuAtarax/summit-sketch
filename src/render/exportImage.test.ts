import { describe, expect, it } from 'vitest';
import {
  bestSeamAz,
  EXPORT_MAX_PIXELS,
  EXPORT_PX_PER_DEG,
  fitScale,
  footerFontFor,
  planExport,
} from './exportImage';
import type { LabeledPeak } from './labels';

const area = (p: ReturnType<typeof planExport>) => p.width * (p.plotHeight + p.footerHeight);

describe('planExport', () => {
  it('keeps the wanted resolution when the image fits', () => {
    const plan = planExport(360, 20, 1.5, EXPORT_PX_PER_DEG);
    expect(plan.pxPerDeg).toBe(EXPORT_PX_PER_DEG);
    expect(plan.width).toBe(5760);
    expect(plan.plotHeight).toBe(480);
    expect(plan.footerHeight).toBeGreaterThan(0);
  });

  it('lowers the resolution until the whole image fits the pixel cap', () => {
    // 360 deg x 120 deg x 3 vertical exaggeration would be ~100 Mpx at 16 px/deg.
    const plan = planExport(360, 120, 3, EXPORT_PX_PER_DEG);
    expect(plan.pxPerDeg).toBeLessThan(EXPORT_PX_PER_DEG);
    expect(area(plan)).toBeLessThanOrEqual(EXPORT_MAX_PIXELS);
    // Not needlessly low: one step (5 %) higher would not fit.
    const oneStepUp = planExport(360, 120, 3, plan.pxPerDeg / 0.95, Infinity);
    expect(area(oneStepUp)).toBeGreaterThan(EXPORT_MAX_PIXELS);
  });

  it('scales the footer text with the image, within sane bounds', () => {
    expect(footerFontFor(400)).toBe(14);
    expect(footerFontFor(5760)).toBe(48);
    expect(footerFontFor(3600)).toBe(40);
  });
});

function label(az: number, dx: number, w: number): LabeledPeak {
  return {
    id: 1,
    name: 'P',
    az,
    angle: 5,
    elev: 3000,
    dist: 1000,
    box: { dx, dy: -30, w, h: 18 },
  };
}

describe('bestSeamAz', () => {
  it('starts at north when nothing is there', () => {
    expect(bestSeamAz([label(100, -20, 40)], 16)).toBe(0);
  });

  it('moves the seam off a label that would be cut at north', () => {
    // A label box of 160 px (10 deg) centered on az 0 covers roughly 355..5.
    const az = bestSeamAz([label(0, -80, 160)], 16);
    expect(az).toBeGreaterThan(5);
    expect(az).toBeLessThan(355);
    // The nearest free azimuth to north is chosen: just past the label's edge.
    expect(Math.min(az, 360 - az)).toBeLessThan(7);
  });

  it('accounts for labels wrapping around the circle', () => {
    const az = bestSeamAz([label(359, -80, 160)], 16); // covers ~354..4
    expect(az >= 4.5 && az <= 353.5).toBe(true);
  });
});

describe('fitScale', () => {
  it('shrinks only text that is too wide', () => {
    expect(fitScale(500, 1000)).toBe(1);
    expect(fitScale(2000, 1000)).toBe(0.5);
    expect(fitScale(0, 1000)).toBe(1);
  });
});
