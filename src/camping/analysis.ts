/**
 * Terrain analysis for camping spots on metric rasters (row-major, north up, NaN = no data).
 * All functions are pure and work on Float32Array grids of `width` x `height` cells of
 * `cell` meters.
 */

const R2D = 180 / Math.PI;

/** Horn's gradient (dz/dx east, dz/dy north) at an interior cell, or null near the border/NaN. */
function gradient(
  z: Float32Array,
  width: number,
  x: number,
  y: number,
  cell: number,
): { gx: number; gy: number } | null {
  const i = y * width + x;
  const a = z[i - width - 1]!;
  const b = z[i - width]!;
  const c = z[i - width + 1]!;
  const d = z[i - 1]!;
  const f = z[i + 1]!;
  const g = z[i + width - 1]!;
  const h = z[i + width]!;
  const k = z[i + width + 1]!;
  if ([a, b, c, d, f, g, h, k, z[i]!].some(Number.isNaN)) return null;
  return {
    gx: (c + 2 * f + k - (a + 2 * d + g)) / (8 * cell),
    // Rows run north to south, so north is up in the array.
    gy: (a + 2 * b + c - (g + 2 * h + k)) / (8 * cell),
  };
}

/** Slope in degrees (Horn's method); NaN at the border and next to no-data. */
export function slopeDegrees(
  z: Float32Array,
  width: number,
  height: number,
  cell: number,
): Float32Array {
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const g = gradient(z, width, x, y, cell);
      if (g) out[y * width + x] = Math.atan(Math.hypot(g.gx, g.gy)) * R2D;
    }
  }
  return out;
}

/**
 * Small-scale roughness in meters: the RMS distance of the 8 neighbours from the local
 * plane through the cell. About 0 on smooth meadow, large on boulders, tussocks and hollows.
 * At 2 m cells the window is 6 m, the size of a tent pitch.
 */
export function roughness(
  z: Float32Array,
  width: number,
  height: number,
  cell: number,
): Float32Array {
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const g = gradient(z, width, x, y, cell);
      if (!g) continue;
      const centre = z[y * width + x]!;
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          // East is +x; north is -row, hence the sign on dy.
          const predicted = centre + g.gx * dx * cell - g.gy * dy * cell;
          const r = z[(y + dy) * width + (x + dx)]! - predicted;
          sum += r * r;
        }
      }
      out[y * width + x] = Math.sqrt(sum / 8);
    }
  }
  return out;
}

/** Mean of factor x factor blocks (NaN if any cell of a block is NaN): 0.5 m to 2 m, e.g. */
export function downsampleMean(
  data: Float32Array,
  width: number,
  height: number,
  factor: number,
): { data: Float32Array; width: number; height: number } {
  const w = Math.floor(width / factor);
  const h = Math.floor(height / factor);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++)
          sum += data[(y * factor + dy) * width + x * factor + dx]!;
      }
      out[y * w + x] = sum / (factor * factor);
    }
  }
  return { data: out, width: w, height: h };
}

/** Surface minus terrain: height of trees, shrubs, boulders and buildings above the ground. */
export function objectHeight(surface: Float32Array, terrain: Float32Array): Float32Array {
  const out = new Float32Array(terrain.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.max(0, surface[i]! - terrain[i]!);
  return out;
}

const smoothstep = (edge0: number, edge1: number, v: number): number => {
  const t = Math.min(1, Math.max(0, (v - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
};

/**
 * Thresholds of the suitability model. Each criterion is fully fine up to its "ok" value,
 * ruled out from its "max" value, and fades smoothly in between.
 */
export interface SuitabilityParams {
  /** Slope up to this is fully fine for a tent, degrees. */
  slopeOkDeg: number;
  /** Slope from this on is unusable, degrees. */
  slopeMaxDeg: number;
  /** Roughness up to this is smooth ground, meters (RMS over a 6 m window at 2 m cells). */
  roughOkM: number;
  /** Roughness from this on is unusable (boulders, tussocks), meters. */
  roughMaxM: number;
  /** Vegetation or objects up to this height are fine (grass), meters. */
  canopyOkM: number;
  /** Vegetation from this height on is unusable (shrubs, forest), meters. */
  canopyMaxM: number;
  /** A pitch needs good ground this many cells around it (0 = one cell, 1 = 3 x 3 cells). */
  patchRadiusCells: number;
  /** Rule out lakes and other perfectly flat surfaces (see flatSurfaceMask). */
  excludeWater: boolean;
}

/** Recommended defaults (see the explanations in the settings panel). */
export const DEFAULT_SUITABILITY: SuitabilityParams = {
  slopeOkDeg: 5,
  slopeMaxDeg: 10,
  roughOkM: 0.08,
  roughMaxM: 0.3,
  canopyOkM: 0.5,
  canopyMaxM: 3,
  patchRadiusCells: 1,
  excludeWater: true,
};

/**
 * Lakes are the flattest thing in an elevation model: the surface is set to one constant
 * height, while real ground (even a pasture) varies by centimeters over ten meters. A cell is
 * marked (1) when the whole (2r+1) x (2r+1) neighbourhood varies by less than `maxRangeM`;
 * everything else is 0, and cells without data or near the border are NaN. Paved and
 * levelled areas are caught too, which is fine: nobody wants to pitch a tent there.
 */
export function flatSurfaceMask(
  z: Float32Array,
  width: number,
  height: number,
  radius = 2,
  maxRangeM = 0.02,
): Float32Array {
  const out = new Float32Array(width * height).fill(Number.NaN);
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let dy = -radius; dy <= radius && hi - lo < maxRangeM * 4; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const v = z[(y + dy) * width + x + dx]!;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      // NaN never updates lo/hi, so a window with holes only counts if the rest is flat.
      const hasHole = Number.isNaN(z[y * width + x]!);
      out[y * width + x] = hasHole ? Number.NaN : hi - lo < maxRangeM ? 1 : 0;
    }
  }
  return out;
}

/**
 * Pitch suitability 0..1 per cell: gentle slope, smooth ground and (when known) no tall
 * vegetation, multiplied so that any one failing criterion rules the cell out.
 */
export function pitchSuitability(
  slope: Float32Array,
  rough: Float32Array,
  canopy?: Float32Array,
  s: SuitabilityParams = DEFAULT_SUITABILITY,
  water?: Float32Array,
): Float32Array {
  const out = new Float32Array(slope.length);
  for (let i = 0; i < out.length; i++) {
    if (Number.isNaN(slope[i]!) || Number.isNaN(rough[i]!)) {
      out[i] = Number.NaN;
      continue;
    }
    if (s.excludeWater && water && water[i] === 1) {
      out[i] = 0;
      continue;
    }
    let v =
      (1 - smoothstep(s.slopeOkDeg, s.slopeMaxDeg, slope[i]!)) *
      (1 - smoothstep(s.roughOkM, s.roughMaxM, rough[i]!));
    if (canopy && !Number.isNaN(canopy[i]!))
      v *= 1 - smoothstep(s.canopyOkM, s.canopyMaxM, canopy[i]!);
    out[i] = v;
  }
  return out;
}

/**
 * Keeps a cell only if every cell within `radius` cells is at least as suitable: a pitch
 * needs a whole patch of good ground, not a single lucky cell. NaN counts as unsuitable.
 */
export function patchMinimum(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const rows = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = Infinity;
      for (let dx = -radius; dx <= radius; dx++) {
        const xx = x + dx;
        const v = xx < 0 || xx >= width ? 0 : data[y * width + xx]!;
        m = Math.min(m, Number.isNaN(v) ? 0 : v);
      }
      rows[y * width + x] = m;
    }
  }
  const out = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = Infinity;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = y + dy;
        m = Math.min(m, yy < 0 || yy >= height ? 0 : rows[yy * width + x]!);
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/** Share of cells above a threshold among the cells with data, for quick sanity numbers. */
export function shareAbove(data: Float32Array, threshold: number): number {
  let valid = 0;
  let above = 0;
  for (const v of data) {
    if (Number.isNaN(v)) continue;
    valid++;
    if (v >= threshold) above++;
  }
  return valid ? above / valid : 0;
}
