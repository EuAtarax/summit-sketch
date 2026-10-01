import { describe, expect, it } from 'vitest';
import { eeaQueryUrl, fetchEeaAreas, parseEea } from './eea';

const box = { south: 47.05, west: 12.4, north: 47.08, east: 12.45 };
const ring = [
  [4_484_000, 2_652_000],
  [4_486_000, 2_652_000],
  [4_486_000, 2_654_000],
  [4_484_000, 2_652_000],
];

describe('EEA protected areas', () => {
  it('asks for outlines in the grid CRS, simplified to about a cell', () => {
    const layer = { id: 'eea:natda', path: 'NatDAv24_Dyna_WM/MapServer/3', fields: 'siteName' };
    const url = new URL(eeaQueryUrl(layer, box, 3035));
    expect(url.searchParams.get('outSR')).toBe('3035');
    expect(url.searchParams.get('geometry')).toBe('12.4,47.05,12.45,47.08');
    expect(url.searchParams.get('maxAllowableOffset')).toBe('2');
  });

  it('lets strictly protected areas restrict and lists the rest', () => {
    const natda = parseEea(
      {
        features: [
          {
            attributes: {
              siteName: 'Nationalpark Hohe Tauern Kernzone',
              iucnCategory: 'II',
              strictProtection: 'yes',
            },
            geometry: { rings: [ring] },
          },
          {
            attributes: {
              siteName: 'Nationalpark Hohe Tauern Aussenzone',
              iucnCategory: 'II',
              strictProtection: 'no',
            },
            geometry: { rings: [ring] },
          },
        ],
      },
      'eea:natda',
    );
    expect(natda[0]).toMatchObject({
      kind: 'National park (IUCN II)',
      restricts: true,
      inForce: true,
    });
    expect(natda[1]!.restricts).toBe(false);

    const natura = parseEea(
      {
        features: [
          {
            attributes: { SITECODE: 'AT3301000', SITENAME: 'Hohe Tauern, Tirol' },
            geometry: { rings: [ring] },
          },
        ],
      },
      'eea:natura2000-habitats',
    );
    expect(natura[0]).toMatchObject({
      kind: 'Natura 2000 habitat site',
      name: 'Hohe Tauern, Tirol',
      restricts: false,
    });
    expect(natura[0]!.polygons[0]![0]![1]).toEqual([4_486_000, 2_652_000]);
  });

  it('reports a service error', () => {
    expect(() => parseEea({ error: { message: 'boom' } }, 'eea:natda')).toThrow('boom');
  });

  it('asks every layer and paints restricting areas last', async () => {
    const fetchFn = async (url: string) => {
      const attributes = url.includes('NatDA')
        ? { siteName: 'Kern', iucnCategory: 'Ia', strictProtection: 'no' }
        : { SITENAME: 'Site' };
      const body = { features: [{ attributes, geometry: { rings: [ring] } }] };
      return new Response(JSON.stringify(body), { status: 200 });
    };
    const areas = await fetchEeaAreas(box, 3035, fetchFn);
    expect(areas).toHaveLength(3);
    expect(areas[areas.length - 1]!.name).toBe('Kern'); // IUCN Ia restricts: painted on top
  });
});
