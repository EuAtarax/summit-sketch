import { TILE_SIZE } from '../geo/tiles';
import type { TileGrid } from '../terrain/tileGrid';
import { rayOrigin, rayPointToPx, type RaySamples } from './sampling';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export interface CastParams {
  lat: number;
  lon: number;
  /** Absolute eye height: ground elevation + eye height, meters. */
  observerHeight: number;
  azStep: number;
  rayStart: number;
  rayCount: number;
  samples: RaySamples;
  /** One grid per entry of samples.bands. */
  grids: TileGrid[];
  /** Crests whose hidden dip behind them is shallower than this are dropped (degrees). */
  minCrestDropDeg: number;
  /** Treat negative elevations (bathymetry) as sea level. */
  clampSeaLevel: boolean;
  onProgress?: (raysDone: number) => void;
}

/** Visible crests and the outer horizon for a contiguous range of rays. */
export interface CastResult {
  rayStart: number;
  rayCount: number;
  horizonAngle: Float32Array;
  horizonDist: Float32Array;
  /** Crests of ray r are at indices crestOffsets[r] .. crestOffsets[r + 1] - 1, near to far. */
  crestOffsets: Uint32Array;
  crestAngle: Float32Array;
  crestDist: Float32Array;
  crestElev: Float32Array;
}

/**
 * Walks each ray outward, tracking the running maximum of the elevation angle. A sample
 * is visible when its angle exceeds the running max. Going from visible to hidden records
 * the last visible sample as a crest. A crest is kept only if the terrain behind it dips
 * at least minCrestDropDeg below it (filters DEM noise on slopes facing the observer).
 * The last visible point of every ray is always kept: it is the skyline.
 * Comparisons use tan(angle), which is monotonic, and convert to degrees only on output.
 */
export function castRays(p: CastParams): CastResult {
  const { samples, grids, rayCount } = p;
  const { dist, band, sinD, cosD, drop } = samples;
  const o = rayOrigin(p.lat, p.lon);
  const worldPx = samples.bands.map((b) => TILE_SIZE * 2 ** b.zoom);
  const hObs = p.observerHeight;
  const minDropRad = p.minCrestDropDeg * D2R;
  const pt = { x: 0, y: 0 };

  const horizonAngle = new Float32Array(rayCount);
  const horizonDist = new Float32Array(rayCount);
  const crestOffsets = new Uint32Array(rayCount + 1);
  const cAngle: number[] = [];
  const cDist: number[] = [];
  const cElev: number[] = [];

  for (let r = 0; r < rayCount; r++) {
    crestOffsets[r] = cAngle.length;
    const theta = (p.rayStart + r) * p.azStep * D2R;
    const sinT = Math.sin(theta);
    const cosT = Math.cos(theta);

    let maxT = -Infinity;
    let maxD = 0;
    let visible = false;
    let visT = 0;
    let visD = 0;
    let visH = 0;
    let pending = false;
    let pendT = 0;
    let pendD = 0;
    let pendH = 0;
    let pendMinT = 0;

    let bi = -1;
    let grid: TileGrid | undefined;
    let wpx = 0;

    for (let i = 0; i < samples.count; i++) {
      if (band[i] !== bi) {
        bi = band[i]!;
        grid = grids[bi];
        wpx = worldPx[bi]!;
      }
      rayPointToPx(o, sinT, cosT, sinD[i]!, cosD[i]!, wpx, pt);
      let h = grid!.sample(pt.x, pt.y);
      if (Number.isNaN(h)) continue;
      if (p.clampSeaLevel && h < 0) h = 0;
      const d = dist[i]!;
      const t = (h - drop[i]! - hObs) / d;

      if (t > maxT) {
        if (pending) {
          if (Math.atan(pendT) - Math.atan(pendMinT) >= minDropRad) {
            cAngle.push(Math.atan(pendT) * R2D);
            cDist.push(pendD);
            cElev.push(pendH);
          }
          pending = false;
        }
        maxT = t;
        maxD = d;
        visible = true;
        visT = t;
        visD = d;
        visH = h;
      } else if (visible) {
        visible = false;
        pending = true;
        pendT = visT;
        pendD = visD;
        pendH = visH;
        pendMinT = t;
      } else if (pending && t < pendMinT) {
        pendMinT = t;
      }
    }

    // The outermost visible point is the skyline; keep it regardless of the dip.
    if (pending || visible) {
      cAngle.push(Math.atan(pending ? pendT : visT) * R2D);
      cDist.push(pending ? pendD : visD);
      cElev.push(pending ? pendH : visH);
    }
    horizonAngle[r] = maxT === -Infinity ? NaN : Math.atan(maxT) * R2D;
    horizonDist[r] = maxD;
    if (p.onProgress && (r & 63) === 63) p.onProgress(r + 1);
  }
  crestOffsets[rayCount] = cAngle.length;

  return {
    rayStart: p.rayStart,
    rayCount,
    horizonAngle,
    horizonDist,
    crestOffsets,
    crestAngle: Float32Array.from(cAngle),
    crestDist: Float32Array.from(cDist),
    crestElev: Float32Array.from(cElev),
  };
}

/** Concatenates contiguous sector results (in ray order) into one result. */
export function mergeCastResults(parts: CastResult[]): CastResult {
  const sorted = [...parts].sort((a, b) => a.rayStart - b.rayStart);
  const rayCount = sorted.reduce((s, x) => s + x.rayCount, 0);
  const crestCount = sorted.reduce((s, x) => s + x.crestAngle.length, 0);
  const out: CastResult = {
    rayStart: sorted[0]?.rayStart ?? 0,
    rayCount,
    horizonAngle: new Float32Array(rayCount),
    horizonDist: new Float32Array(rayCount),
    crestOffsets: new Uint32Array(rayCount + 1),
    crestAngle: new Float32Array(crestCount),
    crestDist: new Float32Array(crestCount),
    crestElev: new Float32Array(crestCount),
  };
  let r0 = 0;
  let c0 = 0;
  for (const part of sorted) {
    out.horizonAngle.set(part.horizonAngle, r0);
    out.horizonDist.set(part.horizonDist, r0);
    for (let r = 0; r < part.rayCount; r++) out.crestOffsets[r0 + r] = c0 + part.crestOffsets[r]!;
    out.crestAngle.set(part.crestAngle, c0);
    out.crestDist.set(part.crestDist, c0);
    out.crestElev.set(part.crestElev, c0);
    r0 += part.rayCount;
    c0 += part.crestAngle.length;
  }
  out.crestOffsets[rayCount] = c0;
  return out;
}
