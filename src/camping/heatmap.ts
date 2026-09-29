import { lv95ToWgs84, wgs84ToLv95 } from './lv95';
import type { GridWindow } from './terrain';

export type Rgba = readonly [number, number, number, number];

export interface RampStop {
  at: number;
  color: Rgba;
}

/** Piecewise-linear color for a value; NaN (no data) is fully transparent. */
export function sampleRamp(stops: readonly RampStop[], value: number): Rgba {
  if (Number.isNaN(value)) return [0, 0, 0, 0];
  const first = stops[0]!;
  const last = stops[stops.length - 1]!;
  if (value <= first.at) return first.color;
  if (value >= last.at) return last.color;
  for (let i = 1; i < stops.length; i++) {
    const b = stops[i]!;
    if (value <= b.at) {
      const a = stops[i - 1]!;
      const t = (value - a.at) / (b.at - a.at);
      return a.color.map((c, k) => c + (b.color[k]! - c) * t) as unknown as Rgba;
    }
  }
  return last.color;
}

export type LayerId = 'suitability' | 'slope' | 'roughness' | 'canopy';

export const LAYERS: Record<
  LayerId,
  { label: string; unit: string; max: number; stops: RampStop[] }
> = {
  suitability: {
    label: 'Pitch suitability',
    unit: '',
    max: 1,
    stops: [
      { at: 0, color: [0, 0, 0, 0] },
      { at: 0.05, color: [230, 200, 40, 0] },
      { at: 0.3, color: [230, 200, 40, 110] },
      { at: 0.7, color: [110, 200, 60, 170] },
      { at: 1, color: [20, 160, 60, 210] },
    ],
  },
  slope: {
    label: 'Slope',
    unit: '°',
    max: 45,
    stops: [
      { at: 0, color: [40, 150, 60, 150] },
      { at: 5, color: [150, 200, 60, 150] },
      { at: 10, color: [240, 200, 40, 160] },
      { at: 20, color: [230, 120, 30, 170] },
      { at: 35, color: [190, 30, 40, 190] },
      { at: 50, color: [90, 20, 60, 200] },
    ],
  },
  roughness: {
    label: 'Roughness (6 m)',
    unit: ' m',
    max: 0.6,
    stops: [
      { at: 0, color: [40, 150, 60, 130] },
      { at: 0.08, color: [150, 200, 60, 150] },
      { at: 0.3, color: [230, 120, 30, 180] },
      { at: 0.6, color: [150, 20, 40, 200] },
    ],
  },
  canopy: {
    label: 'Vegetation and object height',
    unit: ' m',
    max: 15,
    stops: [
      { at: 0, color: [0, 0, 0, 0] },
      { at: 0.5, color: [170, 220, 120, 90] },
      { at: 3, color: [60, 150, 60, 170] },
      { at: 15, color: [10, 70, 40, 220] },
    ],
  },
};

export interface Overlay {
  canvas: HTMLCanvasElement;
  /** [[south, west], [north, east]] for Leaflet. */
  bounds: [[number, number], [number, number]];
}

const MAX_OVERLAY_PX = 1200;

/**
 * Paints a raster in LV95 onto a north-up WGS84 canvas so it lines up with web map tiles.
 * The LV95 grid is rotated against geographic north (about 1 degree in eastern Switzerland),
 * so each output pixel is looked up in the grid rather than drawing the grid as an image.
 */
export function renderOverlay(
  grid: GridWindow,
  values: Float32Array,
  stops: readonly RampStop[],
): Overlay {
  const sizeM = grid.width * grid.cell;
  const corners = [
    lv95ToWgs84(grid.e0, grid.n0),
    lv95ToWgs84(grid.e0 + sizeM, grid.n0),
    lv95ToWgs84(grid.e0, grid.n0 - grid.height * grid.cell),
    lv95ToWgs84(grid.e0 + sizeM, grid.n0 - grid.height * grid.cell),
  ];
  const south = Math.min(...corners.map((c) => c.lat));
  const north = Math.max(...corners.map((c) => c.lat));
  const west = Math.min(...corners.map((c) => c.lon));
  const east = Math.max(...corners.map((c) => c.lon));
  const metersPerLon = 111_320 * Math.cos(((south + north) / 2) * (Math.PI / 180));
  const aspect = ((east - west) * metersPerLon) / ((north - south) * 111_200);
  const width = aspect >= 1 ? MAX_OVERLAY_PX : Math.round(MAX_OVERLAY_PX * aspect);
  const height = aspect >= 1 ? Math.round(MAX_OVERLAY_PX / aspect) : MAX_OVERLAY_PX;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(width, height);
  for (let py = 0; py < height; py++) {
    const lat = north - ((py + 0.5) / height) * (north - south);
    for (let px = 0; px < width; px++) {
      const lon = west + ((px + 0.5) / width) * (east - west);
      const p = wgs84ToLv95(lat, lon);
      const col = Math.floor((p.e - grid.e0) / grid.cell);
      const row = Math.floor((grid.n0 - p.n) / grid.cell);
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;
      const [r, g, b, a] = sampleRamp(stops, values[row * grid.width + col]!);
      const at = (py * width + px) * 4;
      image.data[at] = r;
      image.data[at + 1] = g;
      image.data[at + 2] = b;
      image.data[at + 3] = a;
    }
  }
  ctx.putImageData(image, 0, 0);
  return {
    canvas,
    bounds: [
      [south, west],
      [north, east],
    ],
  };
}
