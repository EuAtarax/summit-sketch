import { DEFAULT_SUITABILITY, type SuitabilityParams } from './analysis';
import type { LayerId } from './heatmap';
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from './palettes';

/** Side length of the analysed square, km. */
export const AREA_SIZES_KM = [0.5, 1, 2, 4] as const;
export type AreaKm = (typeof AREA_SIZES_KM)[number];
/** The 0.5 m surface model is 17 MB per km2, so vegetation height is limited to small areas. */
export const MAX_CANOPY_AREA_KM: AreaKm = 1;

export type BaseMapId = 'map' | 'aerial';
const LAYER_IDS: readonly LayerId[] = ['suitability', 'slope', 'roughness', 'canopy', 'water'];

export interface CampingSettings {
  areaKm: AreaKm;
  layer: LayerId;
  palette: PaletteId;
  base: BaseMapId;
  /** Opacity of the heatmap, 0..1. */
  opacity: number;
  /** Load the surface model for vegetation height (only for areas up to MAX_CANOPY_AREA_KM). */
  canopy: boolean;
  /** Ids of the enabled map overlays (see overlays.ts). */
  overlays: string[];
  suitability: SuitabilityParams;
}

export const DEFAULT_SETTINGS: CampingSettings = {
  areaKm: 2,
  layer: 'suitability',
  palette: DEFAULT_PALETTE,
  base: 'map',
  opacity: 0.85,
  canopy: false,
  overlays: [],
  suitability: DEFAULT_SUITABILITY,
};

/** What each tunable is, its recommended value and a short explanation (shown in the panel). */
export const SUITABILITY_CONTROLS: readonly {
  key: keyof Omit<SuitabilityParams, 'excludeWater'>;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  help: string;
}[] = [
  {
    key: 'slopeOkDeg',
    label: 'Comfortable slope',
    unit: '°',
    min: 1,
    max: 15,
    step: 0.5,
    help: 'Up to this slope a tent is comfortable and you do not slide off your mat. About 5° is the usual recommendation.',
  },
  {
    key: 'slopeMaxDeg',
    label: 'Steepest slope',
    unit: '°',
    min: 3,
    max: 30,
    step: 0.5,
    help: 'From this slope on a cell is ruled out. Between the two values the suitability fades. Above 10° sleeping gets hard.',
  },
  {
    key: 'roughMaxM',
    label: 'Bumpiness tolerance',
    unit: ' m',
    min: 0.1,
    max: 0.6,
    step: 0.01,
    help: 'How lumpy the ground may be over a tent-sized patch (boulders, tussocks). Higher accepts rougher ground. The 2 m data only sees coarse bumps.',
  },
  {
    key: 'canopyMaxM',
    label: 'Tallest vegetation',
    unit: ' m',
    min: 1,
    max: 8,
    step: 0.5,
    help: 'Needs the vegetation option. From this height on (bushes, trees) a cell is ruled out; grass is always fine.',
  },
  {
    key: 'patchRadiusCells',
    label: 'Flat patch around the spot',
    unit: ' cells',
    min: 0,
    max: 3,
    step: 1,
    help: 'How much good ground must surround a spot, in 2 m cells on each side. 1 means a 6 m patch (tent plus margin), 0 accepts a lone cell.',
  },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Coerces stored or edited suitability values into a consistent, in-range set. */
export function sanitizeSuitability(raw: unknown): SuitabilityParams {
  const r = (raw ?? {}) as Partial<Record<keyof SuitabilityParams, unknown>>;
  const num = (key: keyof SuitabilityParams, lo: number, hi: number): number => {
    const v = r[key];
    return typeof v === 'number' && Number.isFinite(v)
      ? clamp(v, lo, hi)
      : (DEFAULT_SUITABILITY[key] as number);
  };
  const slopeOkDeg = num('slopeOkDeg', 1, 15);
  // The fade needs room: the steepest slope always lies above the comfortable one.
  const slopeMaxDeg = Math.max(num('slopeMaxDeg', 3, 30), slopeOkDeg + 1);
  const roughOkM = DEFAULT_SUITABILITY.roughOkM;
  const canopyOkM = DEFAULT_SUITABILITY.canopyOkM;
  return {
    slopeOkDeg,
    slopeMaxDeg,
    roughOkM,
    roughMaxM: Math.max(num('roughMaxM', 0.1, 0.6), roughOkM + 0.02),
    canopyOkM,
    canopyMaxM: Math.max(num('canopyMaxM', 1, 8), canopyOkM + 0.5),
    patchRadiusCells: Math.round(num('patchRadiusCells', 0, 3)),
    excludeWater:
      typeof r.excludeWater === 'boolean' ? r.excludeWater : DEFAULT_SUITABILITY.excludeWater,
  };
}

/** Coerces stored settings (which may be old, partial or hand-edited) into valid ones. */
export function sanitizeSettings(raw: unknown): CampingSettings {
  const r = (raw ?? {}) as Partial<Record<keyof CampingSettings, unknown>>;
  const areaKm = AREA_SIZES_KM.find((a) => a === r.areaKm) ?? DEFAULT_SETTINGS.areaKm;
  const layer = LAYER_IDS.find((l) => l === r.layer) ?? DEFAULT_SETTINGS.layer;
  const opacity =
    typeof r.opacity === 'number' && Number.isFinite(r.opacity)
      ? clamp(r.opacity, 0, 1)
      : DEFAULT_SETTINGS.opacity;
  return {
    areaKm,
    layer,
    palette: isPaletteId(r.palette) ? r.palette : DEFAULT_SETTINGS.palette,
    base: r.base === 'aerial' ? 'aerial' : 'map',
    opacity,
    // Vegetation height is only offered for small areas.
    canopy: r.canopy === true && areaKm <= MAX_CANOPY_AREA_KM,
    overlays: Array.isArray(r.overlays) ? r.overlays.filter((o) => typeof o === 'string') : [],
    suitability: sanitizeSuitability(r.suitability),
  };
}

const STORAGE_KEY = 'summit-sketch:camping';

export function loadSettings(): CampingSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeSettings(JSON.parse(raw));
  } catch {
    // Storage unavailable or corrupt: use the defaults.
  }
  return sanitizeSettings(null);
}

export function saveSettings(settings: CampingSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not critical.
  }
}
