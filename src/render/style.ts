import type { PanoramaScene } from '../horizon/scene';
import type { ViewTransform } from './viewTransform';

export interface RenderOptions {
  /** Seed for all randomness, derived from the observer, so view and export match. */
  seed: number;
}

/**
 * A style is a pure renderer of a scene. It may be asked to draw any slice of the
 * panorama (the viewer renders tiles), so it must only depend on the view transform.
 */
export interface PanoramaStyle {
  id: string;
  name: string;
  /** Background above and below the rendered content. */
  paper: string;
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
