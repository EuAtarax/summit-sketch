import { describe, expect, it } from 'vitest';
import { destinationPoint, elevationAngleDeg, EARTH_RADIUS_M } from '../geo/geodesy';
import { TILE_SIZE } from '../geo/tiles';
import { coneTerrain, SyntheticSource, type Cone } from '../terrain/syntheticSource';
import { castSector, computeScene, DEFAULT_HORIZON_OPTIONS, loadGrids } from './pipeline';
import type { CastResult } from './rayCast';
import { buildRaySamples, rayOrigin, rayPointToPx } from './sampling';
import type { Observer } from './scene';

const OBS: Observer = { lat: 46, lon: 8, groundElev: 0, eyeHeight: 2 };
const AZ = 45;
const RAY = Math.round(AZ / DEFAULT_HORIZON_OPTIONS.azStep);

function coneAt(distM: number, height: number, radiusM: number, az = AZ): Cone {
  return { ...destinationPoint(OBS.lat, OBS.lon, az, distM), height, radiusM };
}

function crestsOfRay(c: CastResult, r = 0) {
  const out: { angle: number; dist: number; elev: number }[] = [];
  for (let i = c.crestOffsets[r]!; i < c.crestOffsets[r + 1]!; i++) {
    out.push({ angle: c.crestAngle[i]!, dist: c.crestDist[i]!, elev: c.crestElev[i]! });
  }
  return out;
}

async function castOneRay(cones: Cone[], radiusM: number) {
  const source = new SyntheticSource(coneTerrain(cones));
  const o = { ...DEFAULT_HORIZON_OPTIONS, radiusM };
  return castSector(source, OBS, o, RAY, 1);
}

describe('castRays', () => {
  it('sees a cone at a known distance at the expected angle (±0.01°)', async () => {
    const D = 25_000;
    const H = 500;
    const cast = await castOneRay([coneAt(D, H, 20_000)], 60_000);
    const expected = elevationAngleDeg(H, OBS.groundElev + OBS.eyeHeight, D);
    const crest = crestsOfRay(cast).find((c) => Math.abs(c.dist - D) < 500);
    expect(crest).toBeDefined();
    expect(Math.abs(crest!.angle - expected)).toBeLessThan(0.01);
    expect(Math.abs(cast.horizonAngle[0]! - expected)).toBeLessThan(0.01);
    expect(Math.abs(cast.horizonDist[0]! - D)).toBeLessThan(500);
  });

  it('produces no crest for a cone hidden behind a taller, nearer cone', async () => {
    const near = coneAt(10_000, 1000, 2000);
    const far = coneAt(30_000, 1200, 2000);
    const isFar = (c: { dist: number }) => c.dist > 27_000 && c.dist < 33_000;

    const control = await castOneRay([far], 40_000);
    expect(crestsOfRay(control).some(isFar)).toBe(true);

    const cast = await castOneRay([near, far], 40_000);
    const crests = crestsOfRay(cast);
    expect(crests.some(isFar)).toBe(false);
    expect(crests.some((c) => Math.abs(c.dist - 10_000) < 300)).toBe(true);
  });

  it('applies curvature: a distant cone appears lower than on a flat earth', async () => {
    const D = 100_000;
    const H = 3000;
    const cast = await castOneRay([coneAt(D, H, 30_000)], 120_000);
    const flat = (Math.atan2(H - 2, D) * 180) / Math.PI;
    const curved = elevationAngleDeg(H, 2, D); // includes the 682.8 m drop
    expect(Math.abs(cast.horizonAngle[0]! - curved)).toBeLessThan(0.02);
    expect(flat - cast.horizonAngle[0]!).toBeGreaterThan(0.35);
  });
});

describe('requiredTiles', () => {
  it('covers every sample point of every ray', async () => {
    const o = { ...DEFAULT_HORIZON_OPTIONS, radiusM: 100_000 };
    const samples = buildRaySamples(OBS.lat, o.radiusM);
    const rayStart = 400;
    const rayCount = 300;
    const grids = await loadGrids(
      new SyntheticSource(() => 0),
      OBS,
      samples,
      o.azStep,
      rayStart,
      rayCount,
    );
    const origin = rayOrigin(OBS.lat, OBS.lon);
    const p = { x: 0, y: 0 };
    let missing = 0;
    for (let r = rayStart; r < rayStart + rayCount; r += 3) {
      const theta = (r * o.azStep * Math.PI) / 180;
      for (let i = 0; i < samples.count; i++) {
        const b = samples.bands[samples.band[i]!]!;
        rayPointToPx(
          origin,
          Math.sin(theta),
          Math.cos(theta),
          samples.sinD[i]!,
          samples.cosD[i]!,
          TILE_SIZE * 2 ** b.zoom,
          p,
        );
        if (Number.isNaN(grids[samples.band[i]!]!.sample(p.x, p.y))) missing++;
      }
    }
    expect(missing).toBe(0);
  });

  it('builds samples at half the pixel size per zoom band', () => {
    const s = buildRaySamples(0, 200_000);
    expect(s.bands.map((b) => b.zoom)).toEqual([12, 11, 10, 9]);
    const z12Pixel = 156543.03 / 4096;
    expect(s.dist[1]! - s.dist[0]!).toBeCloseTo(z12Pixel / 2, 6);
    expect(s.dist[s.count - 1]!).toBeLessThanOrEqual(200_000);
    expect(s.sinD[0]).toBeCloseTo(Math.sin(s.dist[0]! / EARTH_RADIUS_M), 15);
  });
});

describe('computeScene', () => {
  it('links a ring-shaped ridge around the observer into one 360° ridgeline', async () => {
    const R = 15_000;
    const ring = (lat: number, lon: number) => {
      const d = Math.hypot((lat - OBS.lat) * 111_195, (lon - OBS.lon) * 111_195 * Math.cos(0.8029));
      return 800 * Math.max(0, 1 - Math.abs(d - R) / 1500);
    };
    const scene = await computeScene(new SyntheticSource(ring), OBS, {
      radiusM: 25_000,
      azStep: 1,
    });
    const full = scene.ridgelines.find((l) => l.points.length === 360);
    expect(full).toBeDefined();
    expect(Math.abs(full!.minDist - R) / R).toBeLessThan(0.05);
    expect(Math.abs(full!.maxDist - R) / R).toBeLessThan(0.05);
    expect(scene.horizonAngle.length).toBe(360);
  });
});
