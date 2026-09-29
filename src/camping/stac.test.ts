import { describe, expect, it } from 'vitest';
import { fetchTileAssets, latestTileAssets, type StacItem } from './stac';

const item = (id: string, gsds: number[]): StacItem => ({
  id,
  assets: Object.fromEntries(
    gsds.flatMap((g) => [
      [
        `${id}_${g}.tif`,
        {
          href: `https://x/${id}_${g}.tif`,
          type: 'image/tiff; application=geotiff; profile=cloud-optimized',
          'eo:gsd': g,
        },
      ],
      [
        `${id}_${g}.xyz.zip`,
        { href: `https://x/${id}_${g}.zip`, type: 'application/x.ascii-xyz+zip', 'eo:gsd': g },
      ],
    ]),
  ),
});

describe('latestTileAssets', () => {
  it('picks the GeoTIFF of the wanted resolution, not the zip or other resolutions', () => {
    const tiles = latestTileAssets([item('swissalti3d_2019_2722-1204', [0.5, 2])], 2);
    expect(tiles.get('2722-1204')?.href).toBe('https://x/swissalti3d_2019_2722-1204_2.tif');
  });

  it('keeps the most recent year per tile', () => {
    const tiles = latestTileAssets(
      [
        item('swissalti3d_2013_2722-1204', [2]),
        item('swissalti3d_2019_2722-1204', [2]),
        item('swissalti3d_2016_2722-1204', [2]),
        item('swissalti3d_2019_2723-1204', [2]),
      ],
      2,
    );
    expect(tiles.get('2722-1204')?.year).toBe(2019);
    expect([...tiles.keys()].sort()).toEqual(['2722-1204', '2723-1204']);
  });

  it('skips items without the resolution and items with unexpected ids', () => {
    const tiles = latestTileAssets(
      [item('swissalti3d_2019_2722-1204', [0.5]), item('odd-id', [2])],
      2,
    );
    expect(tiles.size).toBe(0);
  });
});

describe('fetchTileAssets', () => {
  it('follows pagination and caches identical searches', async () => {
    const pages: Record<string, unknown> = {
      first: {
        features: [item('swissalti3d_2019_2722-1204', [2])],
        links: [{ rel: 'next', href: 'second' }],
      },
      second: { features: [item('swissalti3d_2019_2723-1204', [2])], links: [] },
    };
    let calls = 0;
    const fetchFn = async (url: string) => {
      calls++;
      const key = url.includes('bbox') ? 'first' : url;
      return new Response(JSON.stringify(pages[key]), { status: 200 });
    };
    const box = [9.0, 46.9, 9.1, 47.0] as const;
    const a = await fetchTileAssets('ch.test.pagination', box, 2, fetchFn);
    expect([...a.keys()].sort()).toEqual(['2722-1204', '2723-1204']);
    expect(calls).toBe(2);
    await fetchTileAssets('ch.test.pagination', box, 2, fetchFn);
    expect(calls).toBe(2);
  });

  it('reports a failed search and does not cache it', async () => {
    let fail = true;
    const fetchFn = async () =>
      fail
        ? new Response('down', { status: 503 })
        : new Response(JSON.stringify({ features: [] }), { status: 200 });
    const box = [8.0, 46.0, 8.1, 46.1] as const;
    await expect(fetchTileAssets('ch.test.failure', box, 2, fetchFn)).rejects.toThrow('HTTP 503');
    fail = false;
    expect((await fetchTileAssets('ch.test.failure', box, 2, fetchFn)).size).toBe(0);
  });
});
