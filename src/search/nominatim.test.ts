import { describe, expect, it } from 'vitest';
import type { FetchFn } from '../net/fetch';
import { buildSearchUrl, NominatimClient, parseResults, zoomForSpan } from './nominatim';

const ZUGSPITZE = {
  place_id: 1,
  lat: '47.4211',
  lon: '10.9863',
  name: 'Zugspitze',
  display_name: 'Zugspitze, Garmisch-Partenkirchen, Bavaria, Germany',
  category: 'natural',
  type: 'peak',
  boundingbox: ['47.4210', '47.4212', '10.9862', '10.9864'] as [string, string, string, string],
};
const MUNICH = {
  place_id: 2,
  lat: '48.1372',
  lon: '11.5755',
  display_name: 'Munich, Bavaria, Germany',
  category: 'boundary',
  type: 'administrative',
  boundingbox: ['47.9', '48.3', '11.36', '11.72'] as [string, string, string, string],
};

describe('parseResults', () => {
  it('marks peaks and frames places by their size', () => {
    const [peak, city] = parseResults([ZUGSPITZE, MUNICH]);
    expect(peak).toMatchObject({ name: 'Zugspitze', isPeak: true, zoom: 14, lat: 47.4211 });
    // A city about 0.36 degrees wide is framed at a regional zoom, not a summit zoom.
    expect(city).toMatchObject({ name: 'Munich', isPeak: false });
    expect(city!.zoom).toBeGreaterThanOrEqual(9);
    expect(city!.zoom).toBeLessThanOrEqual(11);
  });

  it('treats volcanoes as summits', () => {
    const [v] = parseResults([{ ...ZUGSPITZE, type: 'volcano' }]);
    expect(v!.isPeak).toBe(true);
  });
});

describe('zoomForSpan', () => {
  it('is clamped and handles missing boxes', () => {
    expect(zoomForSpan(0)).toBe(14);
    expect(zoomForSpan(300)).toBe(3);
    expect(zoomForSpan(0.0001)).toBe(15);
  });
});

describe('buildSearchUrl', () => {
  it('encodes the query and asks for a small, deduplicated result list', () => {
    const url = new URL(buildSearchUrl('Hohe Wand / Hochwand', 'de'));
    expect(url.searchParams.get('q')).toBe('Hohe Wand / Hochwand');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('accept-language')).toBe('de');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.has('countrycodes')).toBe(false);
  });

  it('can limit results to a country', () => {
    const url = new URL(buildSearchUrl('Glarus', 'de', 'ch'));
    expect(url.searchParams.get('countrycodes')).toBe('ch');
  });
});

describe('NominatimClient', () => {
  const okFetch =
    (times: number[]): FetchFn =>
    async () => {
      times.push(Date.now());
      return new Response(JSON.stringify([ZUGSPITZE]), { status: 200 });
    };

  it('ignores queries that are too short and does not call the network', async () => {
    const times: number[] = [];
    const client = new NominatimClient(okFetch(times), 0, 'en');
    expect(await client.search(' a ')).toEqual([]);
    expect(times).toHaveLength(0);
  });

  it('answers a repeated query from memory, ignoring case and spacing', async () => {
    const times: number[] = [];
    const client = new NominatimClient(okFetch(times), 0, 'en');
    await client.search('Zugspitze');
    const again = await client.search('  zugspitze ');
    expect(again[0]!.name).toBe('Zugspitze');
    expect(times).toHaveLength(1);
  });

  it('spaces consecutive requests by the minimum gap', async () => {
    const times: number[] = [];
    const client = new NominatimClient(okFetch(times), 60, 'en');
    await client.search('first place');
    await client.search('second place');
    expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(55);
  });

  it('cancels a search that is still waiting when a newer one starts', async () => {
    const times: number[] = [];
    const client = new NominatimClient(okFetch(times), 80, 'en');
    await client.search('warm up');
    const stale = client.search('stale query');
    const fresh = client.search('fresh query');
    await expect(stale).rejects.toBeDefined();
    expect((await fresh).length).toBe(1);
    expect(times).toHaveLength(2); // warm up + fresh; the stale one never reached the network
  });

  it('reports HTTP errors and does not cache them', async () => {
    let fail = true;
    const fetchFn: FetchFn = async () =>
      fail ? new Response('busy', { status: 429 }) : new Response(JSON.stringify([MUNICH]));
    const client = new NominatimClient(fetchFn, 0, 'en');
    await expect(client.search('Munich')).rejects.toThrow('Nominatim HTTP 429');
    fail = false;
    expect((await client.search('Munich'))[0]!.name).toBe('Munich');
  });
});
