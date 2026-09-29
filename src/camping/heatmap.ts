import { lv95ToWgs84, wgs84ToLv95 } from './lv95';
import { paletteColor, type PaletteId } from './palettes';
import type { GridGeometry } from './terrain';

export type Rgba = readonly [number, number, number, number];

export type LayerId =
  'score' | 'suitability' | 'slope' | 'roughness' | 'canopy' | 'water' | 'protected';

interface LayerDef {
  label: string;
  /** How good a value is for a tent, 0 (worst) to 1 (best); the palette is applied to this. */
  goodness: (value: number) => number;
  /** Opacity 0..255 for a cell: unsuitable cells of the main layers are left transparent. */
  alpha: (goodness: number, value: number) => number;
  /** A layer with its own meaning (lakes, protected areas) colors itself, whatever the palette. */
  colorOf?: (value: number) => Rgba;
  /** CSS background of the legend bar for such a layer (the palette gradient otherwise). */
  legend?: string;
  /** Legend captions for the two ends of the bar. */
  worst: string;
  best: string;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Higher is better; the two main layers share this look. */
const suitabilityLike = {
  goodness: clamp01,
  alpha: (g: number) => (g < 0.05 ? 0 : 90 + 125 * g),
  worst: 'poor',
  best: 'good pitch',
};

export const LAYERS: Record<LayerId, LayerDef> = {
  score: { label: 'Camp score (terrain, trails, water)', ...suitabilityLike },
  suitability: { label: 'Terrain only (pitch suitability)', ...suitabilityLike },
  slope: {
    label: 'Slope',
    goodness: (v) => 1 - clamp01((v - 5) / 30),
    alpha: () => 165,
    worst: '35° or steeper',
    best: '5° or flatter',
  },
  roughness: {
    label: 'Roughness (6 m)',
    goodness: (v) => 1 - clamp01((v - 0.08) / 0.4),
    alpha: () => 165,
    worst: '0.5 m or rougher',
    best: 'smooth',
  },
  canopy: {
    label: 'Vegetation and object height',
    goodness: (v) => 1 - clamp01(v / 12),
    alpha: (_g, v) => (v < 0.3 ? 0 : 170),
    worst: '12 m or taller',
    best: 'open ground',
  },
  water: {
    label: 'Lakes and flat surfaces',
    goodness: () => 0,
    alpha: () => 0,
    colorOf: (v) => (v === 1 ? [30, 110, 200, 170] : [0, 0, 0, 0]),
    legend: 'rgb(30,110,200)',
    worst: 'lake or level surface',
    best: 'not flat',
  },
  protected: {
    label: 'Protected areas',
    goodness: () => 0,
    alpha: () => 0,
    // 1 = protected but not in force today (e.g. a winter refuge in summer), 2 = in force.
    colorOf: (v) => (v === 2 ? [200, 30, 40, 150] : v === 1 ? [240, 150, 40, 120] : [0, 0, 0, 0]),
    legend: 'linear-gradient(90deg, rgb(240,150,40), rgb(200,30,40))',
    worst: 'not in force today',
    best: 'in force today',
  },
};

/** Value to RGBA for a layer and palette; missing data (NaN) is fully transparent. */
export function makeColorizer(layer: LayerId, palette: PaletteId): (value: number) => Rgba {
  const def = LAYERS[layer];
  return (value) => {
    if (Number.isNaN(value)) return [0, 0, 0, 0];
    if (def.colorOf) return def.colorOf(value);
    const g = def.goodness(value);
    const [r, gr, b] = paletteColor(palette, g);
    return [r, gr, b, def.alpha(g, value)];
  };
}

/** The four corners of a window (north-west first, clockwise) as [lat, lon] pairs. */
export function windowCorners(geometry: GridGeometry): [number, number][] {
  const w = geometry.width * geometry.cell;
  const h = geometry.height * geometry.cell;
  return [
    [geometry.e0, geometry.n0],
    [geometry.e0 + w, geometry.n0],
    [geometry.e0 + w, geometry.n0 - h],
    [geometry.e0, geometry.n0 - h],
  ].map(([e, n]) => {
    const p = lv95ToWgs84(e!, n!);
    return [p.lat, p.lon] as [number, number];
  });
}

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
  grid: GridGeometry,
  values: Float32Array,
  colorOf: (value: number) => Rgba,
): Overlay {
  const corners = windowCorners(grid);
  const south = Math.min(...corners.map((c) => c[0]));
  const north = Math.max(...corners.map((c) => c[0]));
  const west = Math.min(...corners.map((c) => c[1]));
  const east = Math.max(...corners.map((c) => c[1]));
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
      const [r, g, b, a] = colorOf(values[row * grid.width + col]!);
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
