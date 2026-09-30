import { crsOf } from './crs';
import { paletteColor, paletteLut, type PaletteId } from './palettes';
import { windowCorners, type GridGeometry } from './terrain';

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

const CLEAR: Rgba = [0, 0, 0, 0];
const LAKE: Rgba = [30, 110, 200, 170];
const IN_FORCE: Rgba = [200, 30, 40, 150];
const FLAGGED: Rgba = [240, 150, 40, 120];

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
    colorOf: (v) => (v === 1 ? LAKE : CLEAR),
    legend: 'rgb(30,110,200)',
    worst: 'lake or level surface',
    best: 'not flat',
  },
  protected: {
    label: 'Protected areas',
    goodness: () => 0,
    alpha: () => 0,
    // 1 = flagged but hides nothing today (a winter refuge in summer, a nature park), 2 = in force.
    colorOf: (v) => (v === 2 ? IN_FORCE : v === 1 ? FLAGGED : CLEAR),
    legend: 'linear-gradient(90deg, rgb(240,150,40), rgb(200,30,40))',
    worst: 'flagged, hides nothing',
    best: 'in force today',
  },
};

/** Value to RGBA for a layer and palette; missing data (NaN) is fully transparent. */
export function makeColorizer(layer: LayerId, palette: PaletteId): (value: number) => Rgba {
  const def = LAYERS[layer];
  return (value) => {
    if (Number.isNaN(value)) return CLEAR;
    if (def.colorOf) return def.colorOf(value);
    const g = def.goodness(value);
    const [r, gr, b] = paletteColor(palette, g);
    return [r, gr, b, def.alpha(g, value)];
  };
}

/**
 * Where each pixel of a north-up WGS84 image of a grid falls in the grid. The LV95 grid is
 * rotated against geographic north (about 1 degree in eastern Switzerland), so every pixel is
 * projected into the grid rather than drawing the grid as an image. Computed once per
 * analysis: the projection is the slow part, and it never changes when only colors do.
 */
export interface OverlayGrid {
  width: number;
  height: number;
  /** [[south, west], [north, east]] for Leaflet. */
  bounds: [[number, number], [number, number]];
  /** Grid cell index per pixel, row-major from the north; -1 outside the grid. */
  cells: Int32Array;
}

const MAX_OVERLAY_PX = 1200;

export function overlayGrid(grid: GridGeometry): OverlayGrid {
  const corners = windowCorners(grid);
  const south = Math.min(...corners.map((c) => c[0]));
  const north = Math.max(...corners.map((c) => c[0]));
  const west = Math.min(...corners.map((c) => c[1]));
  const east = Math.max(...corners.map((c) => c[1]));
  const metersPerLon = 111_320 * Math.cos(((south + north) / 2) * (Math.PI / 180));
  const aspect = ((east - west) * metersPerLon) / ((north - south) * 111_200);
  const width = aspect >= 1 ? MAX_OVERLAY_PX : Math.round(MAX_OVERLAY_PX * aspect);
  const height = aspect >= 1 ? Math.round(MAX_OVERLAY_PX / aspect) : MAX_OVERLAY_PX;

  const cells = new Int32Array(width * height).fill(-1);
  const { forward } = crsOf(grid);
  for (let py = 0; py < height; py++) {
    const lat = north - ((py + 0.5) / height) * (north - south);
    for (let px = 0; px < width; px++) {
      const lon = west + ((px + 0.5) / width) * (east - west);
      const p = forward(lat, lon);
      const col = Math.floor((p.e - grid.e0) / grid.cell);
      const row = Math.floor((grid.n0 - p.n) / grid.cell);
      if (col < 0 || row < 0 || col >= grid.width || row >= grid.height) continue;
      cells[py * width + px] = row * grid.width + col;
    }
  }
  return {
    width,
    height,
    bounds: [
      [south, west],
      [north, east],
    ],
    cells,
  };
}

/**
 * RGBA pixels of a layer over an overlay grid, colored like makeColorizer (palette colors
 * come from a 256-step table, so they may differ from it by one unit).
 */
export function paintOverlay(
  og: OverlayGrid,
  values: Float32Array,
  layer: LayerId,
  palette: PaletteId,
): Uint8ClampedArray<ArrayBuffer> {
  const def = LAYERS[layer];
  const lut = paletteLut(palette);
  const rgba = new Uint8ClampedArray(og.width * og.height * 4);
  const { cells } = og;
  for (let p = 0; p < cells.length; p++) {
    const cell = cells[p]!;
    if (cell < 0) continue;
    const v = values[cell]!;
    if (v !== v) continue; // no data: transparent
    const at = p * 4;
    if (def.colorOf) {
      const c = def.colorOf(v);
      rgba[at] = c[0];
      rgba[at + 1] = c[1];
      rgba[at + 2] = c[2];
      rgba[at + 3] = c[3];
      continue;
    }
    const g = def.goodness(v);
    const k = Math.round(clamp01(g) * 255) * 3;
    rgba[at] = lut[k]!;
    rgba[at + 1] = lut[k + 1]!;
    rgba[at + 2] = lut[k + 2]!;
    rgba[at + 3] = def.alpha(g, v);
  }
  return rgba;
}
