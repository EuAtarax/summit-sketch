import { describe, expect, it } from 'vitest';
import { nearestPeak, parseEle, parsePeaks, peakQuery, type Peak } from './overpass';
import type { FetchFn } from '../net/fetch';
import { PeakStore, peakTilesFor } from './peakStore';

describe('parseEle', () => {
  it.each([
    ['2962', 2962],
    ['2962 m', 2962],
    ['2962.5', 2962.5],
    ['2962,5', 2962.5],
    ['4,808', 4808],
    ['9,000 ft', 2743.2],
    ["14'505 ft", 4421.12],
    ["4'478 m", 4478],
  ])('parses %s', (raw, expected) => {
    expect(parseEle(raw)).toBeCloseTo(expected, 1);
  });

  it.each([undefined, '', 'unknown', '29620', '~'])('rejects %s', (raw) => {
    expect(parseEle(raw)).toBeNull();
  });
});

describe('peakQuery', () => {
  it('asks only for named peak nodes in the box', () => {
    expect(peakQuery({ south: 47, west: 10, north: 47.5, east: 11 })).toBe(
      '[out:json][timeout:25];node["natural"="peak"]["name"](47.00000,10.00000,47.50000,11.00000);out body;',
    );
  });
});

describe('parsePeaks', () => {
  it('keeps named nodes and parses elevations', () => {
    const peaks = parsePeaks({
      elements: [
        { type: 'node', id: 1, lat: 47.42, lon: 10.98, tags: { name: 'Zugspitze', ele: '2962' } },
        { type: 'node', id: 2, lat: 47.4, lon: 10.9, tags: { name: 'Nameless ele', ele: 'x' } },
        { type: 'node', id: 3, lat: 47.3, lon: 10.8, tags: {} },
        { type: 'way', id: 4 },
      ],
    });
    expect(peaks).toEqual([
      { id: 1, lat: 47.42, lon: 10.98, name: 'Zugspitze', ele: 2962 },
      { id: 2, lat: 47.4, lon: 10.9, name: 'Nameless ele', ele: null },
    ]);
  });
});

describe('nearestPeak', () => {
  const peaks: Peak[] = [
    { id: 1, lat: 47.0, lon: 9.0, name: 'A', ele: 1000 },
    { id: 2, lat: 47.001, lon: 9.0, name: 'B', ele: 1100 }, // ~111 m north of A
  ];

  it('returns the closest peak within the radius', () => {
    expect(nearestPeak(peaks, 47.0008, 9.0, 150)?.name).toBe('B');
  });

  it('returns null when nothing is close enough', () => {
    expect(nearestPeak(peaks, 47.01, 9.0, 150)).toBeNull();
  });
});

describe('PeakStore', () => {
  const json = {
    elements: [
      { type: 'node', id: 7, lat: 47.42, lon: 10.98, tags: { name: 'Zugspitze', ele: '2962' } },
    ],
  };
  const box = { south: 47.41, west: 10.97, north: 47.43, east: 10.99 };

  it('fetches each tile once and serves repeats from the cache', async () => {
    let calls = 0;
    const fetchFn: FetchFn = async () => {
      calls++;
      return new Response(JSON.stringify(json), { status: 200 });
    };
    const store = new PeakStore(fetchFn, []);
    expect(peakTilesFor(box)).toHaveLength(1);
    const [a, b] = await Promise.all([store.ensure(box), store.ensure(box)]);
    expect(a.map((p) => p.name)).toEqual(['Zugspitze']);
    expect(b).toEqual(a);
    await store.ensure(box);
    expect(calls).toBe(1);
  });

  it('backs off and retries when the server is busy', async () => {
    const statuses = [429, 504, 200];
    const fetchFn: FetchFn = async () => {
      const status = statuses.shift()!;
      return new Response(status === 200 ? JSON.stringify(json) : 'busy', { status });
    };
    const store = new PeakStore(fetchFn, [1, 1, 1]);
    expect((await store.ensure(box)).length).toBe(1);
    expect(store.requests).toBe(3);
  });

  it('gives up after the last backoff step', async () => {
    const store = new PeakStore(async () => new Response('busy', { status: 429 }), [1]);
    await expect(store.ensure(box)).rejects.toThrow('Overpass HTTP 429');
  });

  it('gives up on a server that never answers', async () => {
    // Honors the abort signal like fetch does.
    const hang: FetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    const store = new PeakStore(hang, [], 20);
    await expect(store.ensure(box)).rejects.toThrow();
  });

  it('never runs two requests at once', async () => {
    let active = 0;
    let maxActive = 0;
    const fetchFn: FetchFn = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return new Response(JSON.stringify({ elements: [] }), { status: 200 });
    };
    const store = new PeakStore(fetchFn, []);
    const box6 = { south: 47.0, west: 10.0, north: 47.4, east: 10.8 };
    expect(peakTilesFor(box6).length).toBeGreaterThan(1);
    await store.ensure(box6);
    expect(store.requests).toBeGreaterThan(1);
    expect(maxActive).toBe(1);
  });
});
