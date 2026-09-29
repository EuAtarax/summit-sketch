import { describe, expect, it } from 'vitest';
import type { PanoramaScene, Ridgeline } from '../horizon/scene';
import { bandOf, depthT, mix, snowBandDeg, snowlineFor } from './depth';
import { hash2, mulberry32, noise1, rand01 } from './random';
import { indexScene, ridgeRuns } from './sceneIndex';

describe('random', () => {
  it('is deterministic and in range', () => {
    expect(hash2(1, 2)).toBe(hash2(1, 2));
    expect(hash2(1, 2)).not.toBe(hash2(2, 1));
    for (let i = 0; i < 1000; i++) {
      const v = rand01(42, i);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    const a = mulberry32(7);
    const b = mulberry32(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  it('noise1 is continuous, bounded and hits lattice values', () => {
    let prev = noise1(3, 0);
    for (let x = 0.01; x < 20; x += 0.01) {
      const v = noise1(3, x);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.05);
      prev = v;
    }
    expect(noise1(3, 5)).toBeCloseTo(rand01(3, 5) * 2 - 1, 12);
  });
});

describe('depth', () => {
  it('buckets distances into log-scale bands', () => {
    expect([1, 4.9, 5, 14, 39, 99, 100, 250].map((km) => bandOf(km * 1000))).toEqual([
      0, 0, 1, 1, 2, 3, 4, 4,
    ]);
  });

  it('maps distance to 0..1 on a log scale', () => {
    expect(depthT(500, 200_000)).toBe(0);
    expect(depthT(200_000, 200_000)).toBe(1);
    expect(depthT(Math.sqrt(200) * 1000, 200_000)).toBeCloseTo(0.5, 9);
  });

  it('snowline and snow band', () => {
    expect(snowlineFor(47)).toBe(2715);
    expect(snowlineFor(-47)).toBe(2715);
    expect(snowBandDeg(2000, 2715, 10_000)).toBe(0);
    const a = snowBandDeg(3000, 2715, 10_000);
    expect(a).toBeGreaterThan(0);
    expect(snowBandDeg(3300, 2715, 10_000)).toBeGreaterThan(a); // higher → thicker
    expect(snowBandDeg(3000, 2715, 50_000)).toBeLessThan(a); // farther → thinner
  });

  it('mixes colors', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    expect(mix('#ff0000', '#0000ff', 0)).toBe('rgb(255,0,0)');
  });
});

function ridge(az0: number, angles: number[], dist: number): Ridgeline {
  return {
    points: angles.map((angle, i) => ({ az: (az0 + i * 1 + 360) % 360, angle, dist, elev: 1000 })),
    minDist: dist,
    maxDist: dist,
  };
}

function scene(ridgelines: Ridgeline[]): PanoramaScene {
  return {
    observer: { lat: 0, lon: 0, groundElev: 0, eyeHeight: 2 },
    azStep: 1,
    radiusM: 100_000,
    horizonAngle: new Float32Array(360),
    horizonDist: new Float32Array(360),
    ridgelines,
    sea: {
      offsets: new Uint32Array(361),
      lo: new Float32Array(),
      hi: new Float32Array(),
      loDist: new Float32Array(),
      hiDist: new Float32Array(),
    },
  };
}

describe('indexScene', () => {
  it('orders ridges far to near and finds the next crest below in each ray', () => {
    const far = ridge(10, [2, 2, 2], 50_000);
    const near = ridge(11, [-3, -3], 5_000);
    const idx = indexScene(scene([near, far]));
    expect(idx.ridges.map((r) => r.dist)).toEqual([50_000, 5_000]);
    const f = idx.ridges[0]!;
    expect(Array.from(f.below)).toEqual([-90, -3, -3]); // rays 11 and 12 have the near crest
    expect(f.band).toBe(3);
    expect(Array.from(idx.ridges[1]!.below)).toEqual([-90, -90]);
    expect(idx.lowest[10]).toBe(2); // only the far crest
    expect(idx.lowest[11]).toBe(-3); // the near crest is lowest
    expect(idx.lowest[100]).toBe(0); // no crest: the horizon
  });
});

describe('ridgeRuns', () => {
  const idx = indexScene(scene([ridge(350, Array(20).fill(1), 10_000)])); // 350°..369° (wraps)

  it('finds the part of a ridge inside a slice', () => {
    expect(ridgeRuns(idx, 355, 358, 0)).toEqual([{ r: idx.ridges[0], i0: 5, i1: 8, shift: 0 }]);
  });

  it('finds the wrapped part after north', () => {
    const runs = ridgeRuns(idx, 0, 5, 0);
    expect(runs).toEqual([{ r: idx.ridges[0], i0: 10, i1: 15, shift: -360 }]);
  });

  it('applies the margin', () => {
    expect(ridgeRuns(idx, 100, 110, 5)).toEqual([]);
    expect(ridgeRuns(idx, 10, 30, 2)[0]).toMatchObject({ i0: 18, i1: 19, shift: -360 }); // ridge ends at 9°
  });
});
