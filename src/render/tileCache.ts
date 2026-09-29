import type { PanoramaScene } from '../horizon/scene';
import { layoutLabels, type LabelCandidate } from './labelLayout';
import { labelFont, labelMetrics, labelText, type LabeledPeak } from './labels';
import { optionsKey, type PanoramaStyle, type RenderOptions } from './style';
import { TILE_PX, type Level, type TileRef } from './tiles';
import { createViewTransform } from './viewTransform';

/** What a tile depends on besides its position. */
export interface Variant {
  style: PanoramaStyle;
  opts: RenderOptions;
  exaggeration: number;
  /** Peaks to label, in priority order; null or absent for no labels. */
  labelPeaks?: readonly LabelCandidate[] | null;
}

export function variantKey(v: Variant): string {
  return `${optionsKey(v.style, v.opts)}|${v.exaggeration.toFixed(3)}${v.labelPeaks ? '|L' : ''}`;
}

/**
 * Renders the panorama lazily as square tiles and keeps the most recently used ones, for
 * any number of variants (style, options, exaggeration) in one shared LRU. Styles render
 * once per tile, so panning, zooming and switching back to a recent style only copy pixels.
 */
export class TileCache {
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private queue = new Map<string, { variant: Variant; level: Level; kx: number; ky: number }>();
  /** Label layouts per candidate list, style, level and exaggeration (shared by all tiles). */
  private readonly layouts = new WeakMap<readonly LabelCandidate[], Map<string, LabeledPeak[]>>();
  private measureCtx: CanvasRenderingContext2D | undefined;
  /** Tiles rendered so far (for tests and diagnostics). */
  rendered = 0;

  constructor(
    private readonly scene: PanoramaScene,
    private readonly content: { top: number; bottom: number },
    private readonly dpr: number,
    /** Each tile is 1 MB of pixels. */
    private readonly baseTiles = 48,
  ) {
    this.maxTiles = baseTiles;
  }

  private maxTiles: number;

  /**
   * Makes sure the cache can hold what one frame draws (plus headroom). A fixed size
   * thrashed on big screens: tiles evicted before being drawn were re-rendered every
   * frame, which flickered.
   */
  reserve(tilesPerFrame: number): void {
    this.maxTiles = Math.min(256, Math.max(this.baseTiles, Math.ceil(tilesPerFrame * 1.5)));
  }

  private static column(t: { level: Level; kx: number }): number {
    return ((t.kx % t.level.n) + t.level.n) % t.level.n;
  }

  private static key(variant: Variant, level: Level, kx: number, ky: number): string {
    return `${variantKey(variant)}/${level.index}/${kx}/${ky}`;
  }

  /** Cached tile for a reference, or undefined. Marks it as recently used. */
  get(variant: Variant, t: TileRef): HTMLCanvasElement | undefined {
    const key = TileCache.key(variant, t.level, TileCache.column(t), t.ky);
    const c = this.tiles.get(key);
    if (c) {
      this.tiles.delete(key);
      this.tiles.set(key, c);
    }
    return c;
  }

  /** Starts a new frame: only tiles requested from now on will be rendered. */
  beginFrame(): void {
    this.queue = new Map();
  }

  want(variant: Variant, t: TileRef): void {
    const kx = TileCache.column(t);
    const key = TileCache.key(variant, t.level, kx, t.ky);
    if (!this.tiles.has(key)) this.queue.set(key, { variant, level: t.level, kx, ky: t.ky });
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Renders queued tiles for up to budgetMs (at least one). Returns how many were rendered. */
  renderPending(budgetMs: number): number {
    const start = performance.now();
    let done = 0;
    for (const [key, t] of this.queue) {
      if (done > 0 && performance.now() - start > budgetMs) break;
      this.queue.delete(key);
      this.tiles.set(key, this.renderTile(t.variant, t.level, t.kx, t.ky));
      this.rendered++;
      done++;
      while (this.tiles.size > this.maxTiles) {
        this.tiles.delete(this.tiles.keys().next().value as string);
      }
    }
    return done;
  }

  private renderTile(variant: Variant, level: Level, kx: number, ky: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const cssSize = TILE_PX / this.dpr;
    const e = variant.exaggeration;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const view = createViewTransform({
      width: cssSize,
      height: cssSize,
      azStart: kx * level.tileDeg,
      pxPerDeg: level.ppd / this.dpr,
      angleAtTop: this.content.top - (ky * TILE_PX) / (level.ppd * e),
      exaggeration: e,
    });
    const opts = variant.labelPeaks
      ? { ...variant.opts, labels: this.labelsFor(variant, variant.labelPeaks, level) }
      : variant.opts;
    variant.style.render(ctx, this.scene, view, opts);
    return canvas;
  }

  /** The label layout a variant uses at a level (empty without labels). */
  labelLayout(variant: Variant, level: Level): readonly LabeledPeak[] {
    return variant.labelPeaks ? this.labelsFor(variant, variant.labelPeaks, level) : [];
  }

  /**
   * Labels are placed once per (style, level, exaggeration) in absolute az/angle space, so
   * every tile draws the same layout and labels line up across tile edges and the seam.
   */
  private labelsFor(
    variant: Variant,
    peaks: readonly LabelCandidate[],
    level: Level,
  ): LabeledPeak[] {
    const key = `${variant.style.id}|${level.index}|${variant.exaggeration.toFixed(3)}`;
    let perKey = this.layouts.get(peaks);
    if (!perKey) this.layouts.set(peaks, (perKey = new Map()));
    const hit = perKey.get(key);
    if (hit) return hit;

    const style = variant.style.labelStyle;
    this.measureCtx ??= document.createElement('canvas').getContext('2d')!;
    const measure = this.measureCtx;
    measure.font = labelFont(style);
    const layout = layoutLabels(
      peaks,
      {
        pxPerDeg: level.ppd / this.dpr,
        exaggeration: variant.exaggeration,
        angleTop: this.content.top,
      },
      (name) => measure.measureText(labelText(style, name)).width,
      labelMetrics(style),
    );
    perKey.set(key, layout);
    return layout;
  }
}
