import { DEFAULT_SUITABILITY, type SuitabilityParams } from './analysis';
import type { LayerId } from './heatmap';
import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from './palettes';
import { DEFAULT_NEARBY, type NearbyParams } from './scoring';

/** Side length of the analysed square, km. */
export const AREA_SIZES_KM = [0.5, 1, 2, 4] as const;
export type AreaKm = (typeof AREA_SIZES_KM)[number];
/** The 0.5 m surface model is 17 MB per km2, so vegetation height is limited to small areas. */
export const MAX_CANOPY_AREA_KM: AreaKm = 1;

export type BaseMapId = 'map' | 'aerial';
const LAYER_IDS: readonly LayerId[] = [
  'score',
  'suitability',
  'slope',
  'roughness',
  'canopy',
  'water',
  'protected',
];

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
  /** Preferences for being near trails, water and drinking water. */
  nearby: NearbyParams;
  /** Cut ground where a protection is in force out of the camp score. */
  hideProtected: boolean;
  /** Show drinking-water sources as markers on the map. */
  showDrinking: boolean;
  /** Whether the options panel is open; closed by default so the map has the room. */
  panelOpen: boolean;
}

export const DEFAULT_SETTINGS: CampingSettings = {
  areaKm: 2,
  layer: 'score',
  palette: DEFAULT_PALETTE,
  base: 'map',
  opacity: 0.85,
  canopy: false,
  overlays: [],
  suitability: DEFAULT_SUITABILITY,
  nearby: DEFAULT_NEARBY,
  hideProtected: true,
  showDrinking: true,
  panelOpen: false,
};

/** What each pitch tunable is, its range and a short explanation (shown in the panel). */
export const SUITABILITY_CONTROLS: readonly {
  key: keyof SuitabilityParams;
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
    help: 'The steepest ground you still sleep well on. Up to this slope ground counts fully; steeper ground fades out and is ruled out at twice this slope (at 5°, from 10° on). About 5° is the usual recommendation: you do not slide off your mat.',
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

/**
 * The trail, water and drinking-water preferences: one signed slider each (positive = within
 * that distance, negative = at least that far away, 0 = off). Drinking water is near-only.
 */
export const NEARBY_CONTROLS: readonly {
  key: keyof NearbyParams;
  label: string;
  min: number;
  max: number;
  step: number;
  help: string;
}[] = [
  {
    key: 'trail',
    label: 'Trails',
    min: -1000,
    max: 1000,
    step: 25,
    help: '+ prefers spots within this distance of a path, so you can reach them; - prefers spots at least this far from any path. Ground on the path itself is never suggested.',
  },
  {
    key: 'water',
    label: 'Water',
    min: -1500,
    max: 1500,
    step: 50,
    help: '+ prefers spots within this distance of a stream or lake shore; - prefers spots at least this far from water. It only counts water mapped in OpenStreetMap.',
  },
  {
    key: 'drinking',
    label: 'Drinking water',
    min: 0,
    max: 3000,
    step: 100,
    help: 'Prefers spots within this distance of a fountain, tap or spring. Springs need treating; check the markers.',
  },
];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Where slope rules ground out, from the comfortable slope: twice as steep, and at least 3°
 * steeper so the fade never becomes a cliff (5° gives 10°, the usual limit for sleeping).
 */
export const slopeLimitFor = (comfortableDeg: number): number =>
  Math.max(2 * comfortableDeg, comfortableDeg + 3);

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
  // Only the comfortable slope is a setting; the limit follows from it.
  const slopeMaxDeg = slopeLimitFor(slopeOkDeg);
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
  };
}

/**
 * Coerces stored "near" preferences into in-range signed distances. The first version stored
 * `{ enabled, maxM }` per feature: off becomes 0, on keeps its distance.
 */
export function sanitizeNearby(raw: unknown): NearbyParams {
  const r = (raw ?? {}) as Partial<Record<keyof NearbyParams, unknown>>;
  const one = (key: keyof NearbyParams): number => {
    const c = NEARBY_CONTROLS.find((x) => x.key === key)!;
    const stored = r[key];
    const legacy = stored as { enabled?: unknown; maxM?: unknown } | null;
    const value =
      typeof legacy === 'object' && legacy !== null
        ? legacy.enabled === false
          ? 0
          : legacy.maxM
        : stored;
    return typeof value === 'number' && Number.isFinite(value)
      ? clamp(value, c.min, c.max)
      : DEFAULT_NEARBY[key];
  };
  return { trail: one('trail'), water: one('water'), drinking: one('drinking') };
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
    nearby: sanitizeNearby(r.nearby),
    hideProtected:
      typeof r.hideProtected === 'boolean' ? r.hideProtected : DEFAULT_SETTINGS.hideProtected,
    showDrinking:
      typeof r.showDrinking === 'boolean' ? r.showDrinking : DEFAULT_SETTINGS.showDrinking,
    panelOpen: typeof r.panelOpen === 'boolean' ? r.panelOpen : DEFAULT_SETTINGS.panelOpen,
  };
}

/**
 * Applies a change and keeps the settings consistent: vegetation height is only allowed for
 * small areas (it is 17 MB per km2), so growing the area switches it off.
 */
export function withPatch(
  current: CampingSettings,
  patch: Partial<CampingSettings>,
): CampingSettings {
  const next = { ...current, ...patch };
  return next.areaKm > MAX_CANOPY_AREA_KM ? { ...next, canopy: false } : next;
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
