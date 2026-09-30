import { describe, expect, it } from 'vitest';
import { lv95ToWgs84, wgs84ToLv95 } from './lv95';
import {
  fetchProtectedAreas,
  identifyUrl,
  hidesGround,
  isInForce,
  parseProtectedAreas,
  protectionIndex,
  PROTECTION_LAYERS,
} from './protection';

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe('isInForce', () => {
  it('handles a winter period that wraps the year end', () => {
    expect(isInForce('21.12. - 30.04.', d('2026-02-01'))).toBe(true);
    expect(isInForce('21.12. - 30.04.', d('2026-12-24'))).toBe(true);
    expect(isInForce('21.12. - 30.04.', d('2026-07-15'))).toBe(false);
    expect(isInForce('21.12. - 30.04.', d('2026-05-01'))).toBe(false);
  });

  it('handles a period inside one year, including its ends', () => {
    expect(isInForce('01.04. - 30.06.', d('2026-04-01'))).toBe(true);
    expect(isInForce('01.04. - 30.06.', d('2026-06-30'))).toBe(true);
    expect(isInForce('01.04. - 30.06.', d('2026-09-29'))).toBe(false);
  });

  it('reads every period of a text that lists several', () => {
    const two = '01.12. - 31.03. / 01.05. - 15.07.';
    expect(isInForce(two, d('2026-02-01'))).toBe(true);
    expect(isInForce(two, d('2026-06-01'))).toBe(true); // only the second period covers June
    expect(isInForce(two, d('2026-04-15'))).toBe(false);
    expect(isInForce(two, d('2026-09-29'))).toBe(false);
  });

  it('counts a missing or unreadable period as in force (flag rather than miss)', () => {
    expect(isInForce(null, d('2026-07-15'))).toBe(true);
    expect(isInForce('ganzjaehrig', d('2026-07-15'))).toBe(true);
  });
});

/** A square of about 1 km around a WGS84 point as a GeoJSON ring (lon, lat). */
function square(lat: number, lon: number, halfM = 500): [number, number][] {
  const c = wgs84ToLv95(lat, lon);
  return [
    [c.e - halfM, c.n - halfM],
    [c.e + halfM, c.n - halfM],
    [c.e + halfM, c.n + halfM],
    [c.e - halfM, c.n + halfM],
    [c.e - halfM, c.n - halfM],
  ].map(([e, n]) => {
    const p = lv95ToWgs84(e!, n!);
    return [p.lon, p.lat] as [number, number];
  });
}

const ANSWER = {
  results: [
    {
      layerBodId: 'ch.bafu.wrz-wildruhezonen_portal',
      geometry: { type: 'MultiPolygon', coordinates: [[square(46.99, 9.03)]] },
      properties: {
        label: 'Chnuegrat (Nr. 15.00)',
        schutzzeit: '21.12. - 30.04.',
        best_de: 'Betreten nur auf Wegen',
      },
    },
    {
      layerBodId: 'ch.bafu.wrz-wildruhezonen_portal',
      geometry: { type: 'LineString', coordinates: [[9.03, 46.99]] },
      properties: { wegtyp_de: 'Erlaubter Weg' },
    },
    {
      layerBodId: 'ch.bafu.bundesinventare-jagdbanngebiete',
      geometry: { type: 'Polygon', coordinates: [square(46.99, 9.03, 300)] },
      properties: { gebietsname: 'Schilt', typ_de: 'Gebiet mit integralem Schutz' },
    },
    {
      layerBodId: 'ch.bafu.schutzgebiete-paerke_nationaler_bedeutung',
      geometry: { type: 'Polygon', coordinates: [square(46.66, 10.2)] },
      properties: { name: 'Schweizerischer Nationalpark', kategorie: 'SNP' },
    },
    {
      layerBodId: 'ch.unknown.layer',
      geometry: { type: 'Polygon', coordinates: [square(46, 8)] },
      properties: {},
    },
  ],
};

describe('parseProtectedAreas', () => {
  const areas = parseProtectedAreas(ANSWER as never, d('2026-07-15'));

  it('keeps polygons of known layers with their names, kinds and rules', () => {
    expect(areas).toHaveLength(3);
    const zone = areas.find((a) => a.kind === 'Wildlife quiet zone')!;
    expect(zone).toMatchObject({
      name: 'Chnuegrat (Nr. 15.00)',
      period: '21.12. - 30.04.',
      rule: 'Betreten nur auf Wegen',
    });
    expect(areas.find((a) => a.name === 'Schilt')).toMatchObject({
      kind: 'Game reserve',
      rule: 'Gebiet mit integralem Schutz',
    });
  });

  it('recognizes the Swiss National Park inside the parks layer, and it restricts', () => {
    const park = areas.find((a) => a.layer.includes('paerke'))!;
    expect(park.kind).toBe('Swiss National Park');
    expect(hidesGround(park)).toBe(true);
  });

  it('lists regional nature parks and moorland landscapes without letting them hide ground', () => {
    const answer = {
      results: [
        {
          layerBodId: 'ch.bafu.schutzgebiete-paerke_nationaler_bedeutung',
          geometry: { type: 'Polygon', coordinates: [square(46.6, 9.6)] },
          properties: { name: 'Parc Ela', kategorie: 'RN' },
        },
        {
          layerBodId: 'ch.bafu.bundesinventare-moorlandschaften',
          geometry: { type: 'Polygon', coordinates: [square(46.6, 9.6)] },
          properties: { objname: 'Moor' },
        },
      ],
    };
    const listed = parseProtectedAreas(answer as never, d('2026-07-15'));
    expect(listed.map((a) => a.kind)).toEqual(['Nature park', 'Moorland landscape']);
    for (const a of listed) {
      expect(a.inForce).toBe(true); // no period: applies all year
      expect(hidesGround(a)).toBe(false);
    }
  });

  it('marks what is in force on the date and lists the out-of-season restrictions first', () => {
    expect(areas.find((a) => a.kind === 'Wildlife quiet zone')!.inForce).toBe(false); // winter zone in July
    expect(areas.find((a) => a.name === 'Schilt')!.inForce).toBe(true);
    expect(areas[0]!.inForce).toBe(false);
  });

  it('turns coordinates into LV95 rings', () => {
    const ring = areas.find((a) => a.name === 'Schilt')!.polygons[0]![0]!;
    const c = wgs84ToLv95(46.99, 9.03);
    const es = ring.map((p) => p[0]);
    expect(Math.min(...es)).toBeCloseTo(c.e - 300, -1);
    expect(Math.max(...es)).toBeCloseTo(c.e + 300, -1);
  });
});

describe('protectionIndex', () => {
  it('paints areas in order so the ones in force win where they overlap', () => {
    const areas = parseProtectedAreas(ANSWER as never, d('2026-07-15'));
    const c = wgs84ToLv95(46.99, 9.03);
    // A 1.2 km window centered on both areas.
    const g = { e0: c.e - 600, n0: c.n + 600, cell: 4, width: 300, height: 300 };
    const index = protectionIndex(areas, g);
    const at = (dE: number, dN: number) =>
      index[Math.floor((c.n + 600 - (c.n + dN)) / 4) * 300 + Math.floor((600 + dE) / 4)]!;
    const gameReserve = areas.findIndex((a) => a.name === 'Schilt') + 1;
    const zone = areas.findIndex((a) => a.kind === 'Wildlife quiet zone') + 1;
    expect(at(0, 0)).toBe(gameReserve); // both cover the middle; the one in force wins
    expect(at(400, 0)).toBe(zone); // only the winter zone reaches here
    expect(at(590, 0)).toBe(0); // outside both
  });

  it('lets a restriction in force win over a large listed-only park around it', () => {
    const answer = {
      results: [
        ANSWER.results[2]!, // the game reserve, first in the answer
        {
          layerBodId: 'ch.bafu.schutzgebiete-paerke_nationaler_bedeutung',
          geometry: { type: 'Polygon', coordinates: [square(46.99, 9.03)] },
          properties: { name: 'Regionalpark', kategorie: 'RN' },
        },
      ],
    };
    const areas = parseProtectedAreas(answer as never, d('2026-07-15'));
    const c = wgs84ToLv95(46.99, 9.03);
    const g = { e0: c.e - 600, n0: c.n + 600, cell: 4, width: 300, height: 300 };
    const index = protectionIndex(areas, g);
    const middle = index[150 * 300 + 150]!;
    expect(areas[middle - 1]!.name).toBe('Schilt');
    expect(areas[index[150 * 300 + 250]! - 1]!.name).toBe('Regionalpark'); // park only
  });
});

describe('identifyUrl and fetchProtectedAreas', () => {
  it('asks for all known layers in one request, as polygons in WGS84', () => {
    const url = new URL(identifyUrl({ south: 46.9, west: 9, north: 47, east: 9.1 }));
    expect(url.searchParams.get('geometry')).toBe('9,46.9,9.1,47');
    expect(url.searchParams.get('layers')!.startsWith('all:')).toBe(true);
    for (const layer of Object.keys(PROTECTION_LAYERS))
      expect(url.searchParams.get('layers')).toContain(layer);
    expect(url.searchParams.get('geometryFormat')).toBe('geojson');
    expect(url.searchParams.get('returnGeometry')).toBe('true');
  });

  it('parses a successful answer and reports a failing service', async () => {
    const ok = async () => new Response(JSON.stringify(ANSWER), { status: 200 });
    const box = { south: 46.9, west: 9, north: 47, east: 9.1 };
    expect(await fetchProtectedAreas(box, d('2026-07-15'), ok)).toHaveLength(3);
    const down = async () => new Response('down', { status: 503 });
    await expect(fetchProtectedAreas(box, d('2026-07-15'), down)).rejects.toThrow('HTTP 503');
  });
});
