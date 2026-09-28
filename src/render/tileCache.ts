import type { PanoramaScene } from '../horizon/scene';
import type { PanoramaStyle, RenderOptions } from './style';
import { TILE_PX, type Level, type TileRef } from './tiles';
import { createViewTransform } from './viewTransform';

/**
 * Renders the panorama lazily as square tiles and keeps the most recently used ones.
 * Styles render once per tile, so panning and zooming only copy pixels.
 */
export class TileCache {
  private readonly tiles = new Map<string, HTMLCanvasElement>();
  private queue = new Map<string, { level: Level; kx: number; ky: number }>();

  constructor(
    private readonly scene: PanoramaScene,
    private readonly style: PanoramaStyle,
    private readonly opts: RenderOptions,
    private readonly content: { top: number; bottom: number },
    private readonly dpr: number,
    /** Each tile is 1 MB of pixels. */
    private readonly maxTiles = 40,
  ) {}

  private static key(level: Level, kx: number, ky: number): string {
    return `${level.index}/${kx}/${ky}`;
  }

  private static column(t: { level: Level; kx: number }): number {
    return ((t.kx % t.level.n) + t.level.n) % t.level.n;
  }

  /** Cached tile for a reference, or undefined. Marks it as recently used. */
  get(t: TileRef): HTMLCanvasElement | undefined {
    const key = TileCache.key(t.level, TileCache.column(t), t.ky);
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

  want(t: TileRef): void {
    const kx = TileCache.column(t);
    const key = TileCache.key(t.level, kx, t.ky);
    if (!this.tiles.has(key)) this.queue.set(key, { level: t.level, kx, ky: t.ky });
  }

  get pending(): number {
    return this.queue.size;
  }

  /** Renders queued tiles for up to budgetMs. Returns how many were rendered. */
  renderPending(budgetMs: number): number {
    const start = performance.now();
    let done = 0;
    for (const [key, t] of this.queue) {
      if (done > 0 && performance.now() - start > budgetMs) break;
      this.queue.delete(key);
      this.tiles.set(key, this.renderTile(t.level, t.kx, t.ky));
      done++;
      while (this.tiles.size > this.maxTiles) {
        this.tiles.delete(this.tiles.keys().next().value as string);
      }
    }
    return done;
  }

  private renderTile(level: Level, kx: number, ky: number): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;
    const cssSize = TILE_PX / this.dpr;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const view = createViewTransform({
      width: cssSize,
      height: cssSize,
      azStart: kx * level.tileDeg,
      pxPerDeg: level.ppd / this.dpr,
      angleAtTop: this.content.top - (ky * TILE_PX) / level.ppd,
    });
    this.style.render(ctx, this.scene, view, this.opts);
    return canvas;
  }
}
