import { describe, expect, it } from 'vitest';
import type { Cache } from '../cache/idbCache';
import type { FetchFn } from '../peaks/overpassFetch';
import {
  DRINKING_LABELS,
  featuresQuery,
  fetchFeatures,
  parseFeatures,
  roundedBox,
  type OsmFeatures,
} from './osm';

const line = (...pts: [number, number][]) => pts.map(([lat, lon]) => ({ lat, lon }));

const ANSWER = {
  elements: [
    { type: 'way', tags: { highway: 'path' }, geometry: line([46.99, 9.03], [46.991, 9.031]) },
    { type: 'way', tags: { highway: 'motorway' }, geometry: line([46.9, 9.0], [46.91, 9.01]) },
    { type: 'way', tags: { waterway: 'stream' }, geometry: line([46.98, 9.02], [46.981, 9.025]) },
    {
      type: 'way',
      tags: { natural: 'water' },
      geometry: line([46.97, 9.0], [46.971, 9.0], [46.971, 9.001], [46.97, 9.0]),
    },
    {
      type: 'relation',
      tags: { natural: 'water', type: 'multipolygon' },
      members: [{ geometry: line([46.96, 9.0], [46.961, 9.001]) }, { role: 'inner' }],
    },
    {
      type: 'node',
      lat: 46.985,
      lon: 9.035,
      tags: { amenity: 'drinking_water', name: 'Brunnen Oberstafel' },
    },
    { type: 'node', lat: 46.986, lon: 9.036, tags: { natural: 'spring' } },
    {
      type: 'node',
      lat: 46.987,
      lon: 9.037,
      tags: { amenity: 'drinking_water', drinking_water: 'no' },
    },
    { type: 'node', lat: 46.988, lon: 9.038, tags: { amenity: 'fountain' } },
    { type: 'node', lat: 46.989, lon: 9.039, tags: { amenity: 'fountain', drinking_water: 'yes' } },
    { type: 'node', lat: 46.99, lon: 9.04, tags: { man_made: 'water_tap', access: 'private' } },
    {
      type: 'way',
      tags: { amenity: 'water_point' },
      geometry: line([47.0, 9.0], [47.0, 9.002], [47.002, 9.002], [47.002, 9.0]),
    },
  ],
};

describe('parseFeatures', () => {
  const f = parseFeatures(ANSWER as never);

  it('keeps walkable ways and drops roads', () => {
    expect(f.trails).toHaveLength(1);
    expect(f.trails[0]![0]).toEqual({ lat: 46.99, lon: 9.03 });
  });

  it('collects streams, lake outlines and multipolygon lakes as water lines', () => {
    expect(f.water).toHaveLength(3);
  });

  it('finds drinking-water sources of every kind and skips undrinkable or private ones', () => {
    expect(f.drinking.map((d) => d.kind).sort()).toEqual([
      'drinking_water',
      'fountain',
      'spring',
      'water_point',
    ]);
    const named = f.drinking.find((d) => d.name);
    expect(named).toMatchObject({ kind: 'drinking_water', name: 'Brunnen Oberstafel' });
  });

  it('places a source that is mapped as an area at its centroid', () => {
    const point = f.drinking.find((d) => d.kind === 'water_point')!;
    expect(point.lat).toBeCloseTo(47.001, 5);
    expect(point.lon).toBeCloseTo(9.001, 5);
  });

  it('words springs with a safety note', () => {
    expect(DRINKING_LABELS.spring).toMatch(/treat/);
  });

  it('copes with an empty answer', () => {
    expect(parseFeatures({})).toEqual({ trails: [], water: [], drinking: [] });
  });
});

describe('featuresQuery', () => {
  it('asks for geometry and covers trails, water and drinking sources in the box', () => {
    const q = featuresQuery({ south: 46.9, west: 9, north: 47, east: 9.1 });
    expect(q).toContain('out tags geom');
    expect(q).toContain('(46.90000,9.00000,47.00000,9.10000)');
    for (const needle of [
      'highway',
      'waterway',
      'natural"="water',
      'drinking_water',
      'spring',
      'water_tap',
    ]) {
      expect(q).toContain(needle);
    }
  });
});

describe('roundedBox', () => {
  it('rounds outward so the result always contains the input', () => {
    const b = { south: 46.9812, west: 9.0123, north: 46.9931, east: 9.0377 };
    const r = roundedBox(b);
    expect(r.south).toBeLessThanOrEqual(b.south);
    expect(r.west).toBeLessThanOrEqual(b.west);
    expect(r.north).toBeGreaterThanOrEqual(b.north);
    expect(r.east).toBeGreaterThanOrEqual(b.east);
    expect(r.north - r.south).toBeLessThan(b.north - b.south + 0.011);
  });
});

describe('fetchFeatures', () => {
  const box = { south: 46.9812, west: 9.0123, north: 46.9931, east: 9.0377 };
  const memoryCache = () => {
    const store = new Map<string, OsmFeatures>();
    const cache: Cache<OsmFeatures> = {
      get: async (k) => store.get(k),
      set: async (k, v) => void store.set(k, v),
    };
    return { cache, store };
  };

  it('fetches once, caches, and serves nearby spots from the cache', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      return new Response(JSON.stringify(ANSWER), { status: 200 });
    };
    const { cache, store } = memoryCache();
    const first = await fetchFeatures(box, { fetchFn, cache, backoffMs: [] });
    expect(first.trails).toHaveLength(1);
    expect(store.size).toBe(1);
    // A spot a few meters away rounds to the same box.
    await fetchFeatures({ ...box, west: box.west + 0.0004 }, { fetchFn, cache, backoffMs: [] });
    expect(calls).toBe(1);
  });

  it('shares one request between identical concurrent calls', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    };
    const other = { south: 45.5, west: 7.5, north: 45.51, east: 7.52 };
    await Promise.all([
      fetchFeatures(other, { fetchFn, backoffMs: [] }),
      fetchFeatures(other, { fetchFn, backoffMs: [] }),
    ]);
    expect(calls).toBe(1);
  });

  it('reports a failing server and does not cache the failure', async () => {
    const { cache, store } = memoryCache();
    const fetchFn: FetchFn = async () => new Response('down', { status: 500 });
    const far = { south: 46.0, west: 8.0, north: 46.01, east: 8.02 };
    await expect(fetchFeatures(far, { fetchFn, cache, backoffMs: [] })).rejects.toThrow(
      'Overpass HTTP 500',
    );
    expect(store.size).toBe(0);
  });
});
