import type { PanoramaScene } from '../horizon/scene';
import type { LabelStyle, LabeledPeak } from './labels';
import type { ViewTransform } from './viewTransform';

export type PaletteId = 'dawn' | 'day' | 'dusk';

export interface RenderOptions {
  /** Seed for all randomness, derived from the observer, so view and export match. */
  seed: number;
  /** Snowline in meters (default from snowlineFor(lat), adjustable). */
  snowlineM: number;
  /** Palette for styles that offer several (Misty layers). */
  palette: PaletteId;
  /** Placed peak labels for the slice being drawn (Phase 3); null or absent draws none. */
  labels?: readonly LabeledPeak[] | null;
  /** Size factor for labels in large exports (footer-relative); absent or 1 on screen. */
  labelScale?: number;
}

/**
 * A style is a pure renderer of a scene. It may be asked to draw any slice of the
 * panorama (the viewer renders tiles), so it must only depend on the view transform and
 * on absolute azimuth/angle positions.
 */
export interface PanoramaStyle {
  id: string;
  name: string;
  /** Background above the rendered content (sky). */
  paper: (opts: RenderOptions) => string;
  /** Background below the rendered content (nearest ground). */
  ground: (opts: RenderOptions) => string;
  /** Options this style reacts to, so caches and thumbnails can ignore the others. */
  uses: readonly ('snowline' | 'palette')[];
  /** How this style draws peak labels (font, colors, leader line, chip). */
  labelStyle: LabelStyle;
  render(
    ctx: CanvasRenderingContext2D,
    scene: PanoramaScene,
    view: ViewTransform,
    opts: RenderOptions,
  ): void;
}

/** Deterministic seed from the observer position, so on-screen view and export match. */
export function seedFor(lat: number, lon: number): number {
  let h = Math.imul(Math.round(lat * 1e5), 73856093) ^ Math.imul(Math.round(lon * 1e5), 19349663);
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Cache key of the options a style actually uses. */
export function optionsKey(style: PanoramaStyle, o: RenderOptions): string {
  return [
    style.id,
    style.uses.includes('snowline') ? Math.round(o.snowlineM) : '',
    style.uses.includes('palette') ? o.palette : '',
  ].join('|');
}
