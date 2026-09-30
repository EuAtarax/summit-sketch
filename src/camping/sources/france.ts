import type { FetchFn } from '../../net/fetch';
import { parseCogHeader, readImage } from '../tiff';
import type { GridGeometry } from '../terrain';
import type { TerrainSource, TileProgress } from './types';

/**
 * France: IGN's RGE ALTI (terrain, 1 m) and MNS (surface) through the Géoplateforme's raw
 * elevation WMS, which resamples to any box and size in EPSG:3035 and answers with a float32
 * GeoTIFF (CORS-open, no key, Licence Ouverte). The answers are uncompressed (4 MB per 1000 x
 * 1000 pixels), so large boxes are asked for in pieces.
 */
const WMS = 'https://data.geopf.fr/wms-r';
const LAYERS = {
  terrain: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES',
  surface: 'ELEVATION.ELEVATIONGRIDCOVERAGE.HIGHRES.MNS',
} as const;
/** Pixels per side of one request. */
const PIECE = 1000;

/** GetMap for a box in EPSG:3035 (WMS 1.1.1: always easting, northing). */
export function ignUrl(
  layer: keyof typeof LAYERS,
  e0: number,
  n0: number,
  e1: number,
  n1: number,
  width: number,
  height: number,
): string {
  const params = new URLSearchParams({
    SERVICE: 'WMS',
    VERSION: '1.1.1',
    REQUEST: 'GetMap',
    LAYERS: LAYERS[layer],
    STYLES: '',
    SRS: 'EPSG:3035',
    BBOX: `${e0},${n0},${e1},${n1}`,
    WIDTH: String(width),
    HEIGHT: String(height),
    FORMAT: 'image/geotiff',
  });
  return `${WMS}?${params}`;
}

async function loadIgn(
  layer: keyof typeof LAYERS,
  g: GridGeometry,
  factor: number,
  onProgress: TileProgress,
  fetchFn: FetchFn = (u, init) => fetch(u, init),
): Promise<Float32Array> {
  const w = g.width * factor;
  const h = g.height * factor;
  const step = g.cell / factor;
  const out = new Float32Array(w * h).fill(Number.NaN);
  const pieces: { px: number; py: number; pw: number; ph: number }[] = [];
  for (let py = 0; py < h; py += PIECE) {
    for (let px = 0; px < w; px += PIECE) {
      pieces.push({ px, py, pw: Math.min(PIECE, w - px), ph: Math.min(PIECE, h - py) });
    }
  }
  let done = 0;
  onProgress(0, pieces.length);
  await Promise.all(
    pieces.map(async ({ px, py, pw, ph }) => {
      const e0 = g.e0 + px * step;
      const n1 = g.n0 - py * step;
      const url = ignUrl(layer, e0, n1 - ph * step, e0 + pw * step, n1, pw, ph);
      const res = await fetchFn(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`IGN elevation service failed (HTTP ${res.status})`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      const header = parseCogHeader(bytes);
      const image = await readImage(bytes, header.levels[0]!);
      for (let y = 0; y < ph; y++) {
        out.set(image.subarray(y * pw, (y + 1) * pw), (py + y) * w + px);
      }
      onProgress(++done, pieces.length);
    }),
  );
  return out;
}

export const franceSource: TerrainSource = {
  terrain: (g, onProgress, fetchFn) => loadIgn('terrain', g, 1, onProgress, fetchFn),
  async surface(g, onProgress, fetchFn) {
    const factor = Math.round(g.cell); // 1 m, the model's own resolution
    return { data: await loadIgn('surface', g, factor, onProgress, fetchFn), factor };
  },
};
