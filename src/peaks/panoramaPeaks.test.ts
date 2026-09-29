import { describe, expect, it } from 'vitest';
import { distanceM } from '../geo/geodesy';
import { peakQuery, type Peak } from './overpass';
import type { FetchFn } from './overpassFetch';
import {
  bboxesForRadius,
  panoramaPeakKey,
  PanoramaPeakLoader,
  type PeakCacheBackend,
} from './panoramaPeaks';

describe('bboxesForRadius', () => {
  it('contains the disc around a mid-latitude observer', () => {
    const [box, ...rest] = bboxesForRadius(47, 10, 200_000);
    expect(rest).toHaveLength(0);
    // Points 200 km away in the four cardinal directions are inside.
    expect(box!.north).toBeGreaterThan(47 + 1.79);
    expect(box!.south).toBeLessThan(47 - 1.79);
    const halfWidthKm = distanceM(47, box!.west, 47, 10) / 1000;
    expect(halfWidthKm).toBeGreaterThan(200);
    expect(halfWidthKm).toBeLessThan(260); // widened for the pole-ward edge, not absurdly
  });

  it('splits at the antimeridian in both directions', () => {
    const east = bboxesForRadius(-17, 179.5, 200_000);
    expect(east).toHaveLength(2);
    expect(east[0]!.east).toBe(180);
    expect(east[1]!.west).toBe(-180);
    expect(east[1]!.east).toBeLessThan(-175);

    const west = bboxesForRadius(-17, -179.5, 200_000);
    expect(west).toHaveLength(2);
    expect(west[0]!.west).toBeGreaterThan(175);
    expect(west[1]!.east).toBeGreaterThan(-180);
  });

  it('queries the whole longitude circle near the poles', () => {
    expect(bboxesForRadius(88.5, 20, 300_000)).toEqual([
      { south: expect.any(Number), north: 90, west: -180, east: 180 },
    ]);
  });
});

describe('peakQuery with several boxes', () => {
  it('unions the boxes in one request', () => {
    const q = peakQuery([
      { south: 1, west: 2, north: 3, east: 4 },
      { south: 1, west: -5, north: 3, east: -4 },
    ]);
    expect(q).toContain('(node["natural"="peak"]["name"](1.00000,2.00000,3.00000,4.00000);');
    expect(q).toContain('node["natural"="peak"]["name"](1.00000,-5.00000,3.00000,-4.00000););');
  });
});

describe('PanoramaPeakLoader', () => {
  const json = {
    elements: [
      { type: 'node', id: 7, lat: 47.42, lon: 10.98, tags: { name: 'Zugspitze', ele: '2962' } },
    ],
  };
  const okFetch =
    (counter: { n: number }): FetchFn =>
    async () => {
      counter.n++;
      return new Response(JSON.stringify(json), { status: 200 });
    };

  it('shares one request between nearby observers and repeat calls', async () => {
    const counter = { n: 0 };
    const loader = new PanoramaPeakLoader(okFetch(counter), []);
    expect(panoramaPeakKey(47.4201, 10.9799, 200_000)).toBe(
      panoramaPeakKey(47.4199, 10.9801, 200_000),
    );
    const [a, b] = await Promise.all([
      loader.load(47.4201, 10.9799, 200_000),
      loader.load(47.4199, 10.9801, 200_000),
    ]);
    await loader.load(47.42, 10.98, 200_000);
    expect(a.map((p) => p.name)).toEqual(['Zugspitze']);
    expect(b).toEqual(a);
    expect(counter.n).toBe(1);
  });

  it('keeps radii apart in the cache', async () => {
    const counter = { n: 0 };
    const loader = new PanoramaPeakLoader(okFetch(counter), []);
    await loader.load(47.42, 10.98, 100_000);
    await loader.load(47.42, 10.98, 200_000);
    expect(counter.n).toBe(2);
  });

  it('serves from the persistent backend without touching the network', async () => {
    const stored: Peak[] = [{ id: 1, lat: 1, lon: 2, name: 'Stored', ele: 100 }];
    const writes: string[] = [];
    const backend: PeakCacheBackend = {
      get: async () => stored,
      set: async (key) => void writes.push(key),
    };
    const counter = { n: 0 };
    const loader = new PanoramaPeakLoader(okFetch(counter), [], 1000, backend);
    expect(await loader.load(47.42, 10.98, 200_000)).toEqual(stored);
    expect(counter.n).toBe(0);
    expect(writes).toEqual([]);
  });

  it('writes fetched peaks to the backend on a miss', async () => {
    const writes: string[] = [];
    const backend: PeakCacheBackend = {
      get: async () => undefined,
      set: async (key) => void writes.push(key),
    };
    const loader = new PanoramaPeakLoader(okFetch({ n: 0 }), [], 1000, backend);
    await loader.load(47.42, 10.98, 200_000);
    expect(writes).toEqual([panoramaPeakKey(47.42, 10.98, 200_000)]);
  });

  it('retries a busy server with backoff', async () => {
    const statuses = [429, 200];
    const fetchFn: FetchFn = async () => {
      const status = statuses.shift()!;
      return new Response(status === 200 ? JSON.stringify(json) : 'busy', { status });
    };
    const loader = new PanoramaPeakLoader(fetchFn, [1]);
    expect(await loader.load(47.42, 10.98, 200_000)).toHaveLength(1);
    expect(loader.requests).toBe(2);
  });

  it('does not cache a failure', async () => {
    let fail = true;
    const fetchFn: FetchFn = async () =>
      fail ? new Response('nope', { status: 500 }) : new Response(JSON.stringify(json));
    const loader = new PanoramaPeakLoader(fetchFn, []);
    await expect(loader.load(47.42, 10.98, 200_000)).rejects.toThrow('Overpass HTTP 500');
    fail = false;
    expect(await loader.load(47.42, 10.98, 200_000)).toHaveLength(1);
  });
});
