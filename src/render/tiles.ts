import type { PanoramaScene } from '../horizon/scene';

/**
 * The rendered panorama is cached as square tiles of TILE_PX device pixels. A level splits
 * the full circle into n tiles, so tile edges always land on whole pixels and the last
 * tile meets the first one exactly at 360°.
 */
export const TILE_PX = 512;
const LEVEL_TILES = [4, 6, 8, 11, 16, 23, 32, 45, 64, 90, 128, 181, 256];

export interface Level {
  index: number;
  n: number;
  /** Device pixels per degree. */
  ppd: number;
  /** Degrees per tile (both directions). */
  tileDeg: number;
}

export const LEVELS: readonly Level[] = LEVEL_TILES.map((n, index) => ({
  index,
  n,
  ppd: (n * TILE_PX) / 360,
  tileDeg: 360 / n,
}));

/** The coarsest level that still has at least the requested resolution (or the finest). */
export function levelFor(devicePxPerDeg: number): Level {
  return LEVELS.find((l) => l.ppd >= devicePxPerDeg * 0.97) ?? LEVELS[LEVELS.length - 1]!;
}

/** Vertical extent worth showing: a little sky above the horizon, down to the lowest feature. */
export function sceneAngleRange(scene: PanoramaScene): { top: number; bottom: number } {
  let top = -90;
  let bottom = 90;
  for (const a of scene.horizonAngle) {
    if (Number.isNaN(a)) continue;
    if (a > top) top = a;
    if (a < bottom) bottom = a;
  }
  for (const l of scene.ridgelines)
    for (const p of l.points) if (p.angle < bottom) bottom = p.angle;
  for (const lo of scene.sea.lo) if (lo < bottom) bottom = lo;
  if (top < bottom) return { top: 10, bottom: -10 };
  return { top: Math.min(85, top + 3), bottom: Math.max(-85, bottom - 2) };
}

export interface TileRef {
  level: Level;
  /** Unwrapped column (may be negative or ≥ n); the tile to draw is kx mod n. */
  kx: number;
  ky: number;
  /** Top-left corner in viewport device pixels, and the drawn size. */
  x: number;
  y: number;
  size: number;
}

/**
 * Tiles covering a viewport. The view shows azimuth azLeft at x = 0 and angle angleTop at
 * y = 0, at ppd device px/deg. Rows count down from the content top.
 */
export function visibleTiles(
  level: Level,
  view: { azLeft: number; angleTop: number; ppd: number; width: number; height: number },
  content: { top: number; bottom: number },
): TileRef[] {
  const scale = view.ppd / level.ppd;
  const size = TILE_PX * scale;
  const rows = Math.ceil(((content.top - content.bottom) * level.ppd) / TILE_PX);
  const kx0 = Math.floor(view.azLeft / level.tileDeg);
  const kx1 = Math.floor((view.azLeft + view.width / view.ppd) / level.tileDeg);
  const ky0 = Math.max(0, Math.floor(((content.top - view.angleTop) * level.ppd) / TILE_PX));
  const ky1 = Math.min(
    rows - 1,
    Math.floor(((content.top - (view.angleTop - view.height / view.ppd)) * level.ppd) / TILE_PX),
  );
  const out: TileRef[] = [];
  for (let ky = ky0; ky <= ky1; ky++) {
    const rowTop = content.top - (ky * TILE_PX) / level.ppd;
    const y = (view.angleTop - rowTop) * view.ppd;
    for (let kx = kx0; kx <= kx1; kx++) {
      out.push({ level, kx, ky, x: (kx * level.tileDeg - view.azLeft) * view.ppd, y, size });
    }
  }
  return out;
}
