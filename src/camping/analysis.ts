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

/**
 * Vegetation and object height per terrain cell from a finer surface model: for each of the
 * `factor` x `factor` surface pixels in a cell, its height above the terrain (interpolated
 * bilinearly, so a slope does not read as vegetation), and of those the `rank`-th highest
 * (0 = the highest). The default, the second highest, keeps a tree crown that covers a few
 * pixels at full height (an average would shrink a 1 m crown to a quarter) while ignoring a
 * single-pixel spike such as a pole or noise. NaN where the surface has no data.
 */
export function vegetationHeight(
  surface: Float32Array,
  terrain: Float32Array,
  width: number,
  height: number,
  factor: number,
  rank = 1,
): Float32Array {
  const sw = width * factor;
  const out = new Float32Array(width * height);
  const heights = new Float64Array(factor * factor);
  const ground = (u: number, v: number): number => {
    // Bilinear on terrain cell centers, u and v in cell units. The outer half cell lies beyond
    // the last centers: continue the slope there (extrapolate) rather than flatten it.
    const at = (x: number, y: number) => terrain[y * width + x]!;
    if (width < 2 || height < 2) {
      return at(
        Math.min(width - 1, Math.max(0, Math.round(u))),
        Math.min(height - 1, Math.max(0, Math.round(v))),
      );
    }
    const x0 = Math.min(width - 2, Math.max(0, Math.floor(u)));
    const y0 = Math.min(height - 2, Math.max(0, Math.floor(v)));
    const fx = u - x0;
    const fy = v - y0;
    return (
      (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
      (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
    );
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let n = 0;
      for (let dy = 0; dy < factor; dy++) {
        for (let dx = 0; dx < factor; dx++) {
          const sx = x * factor + dx;
          const sy = y * factor + dy;
          const top = surface[sy * sw + sx]!;
          const base = ground((sx + 0.5) / factor - 0.5, (sy + 0.5) / factor - 0.5);
          const h = top - base;
          if (h === h) heights[n++] = Math.max(0, h);
        }
      }
      if (n === 0) {
        out[y * width + x] = Number.NaN;
        continue;
      }
      const values = heights.subarray(0, n).sort().reverse();
      out[y * width + x] = values[Math.min(rank, n - 1)]!;
    }
  }
  return out;
}

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
 * Marks (1) the cells of mapped lakes in a flat-surface mask. Flatness alone misses lakes whose
 * surface the terrain model did not level, and mapped outlines miss unmapped ponds; together
 * they catch both. Cells not in a lake keep their value (0, 1 or NaN).
 */
export function withLakes(flat: Float32Array, lakes: Uint8Array): Float32Array {
  const out = Float32Array.from(flat);
  for (let i = 0; i < out.length; i++) if (lakes[i]) out[i] = 1;
  return out;
}

/**
 * Grows the marked (1) cells of a mask by `radius` cells in every direction (square window), so
 * the shore of a lake is ruled out along with the lake itself. Other cells keep their value.
 */
export function dilateMask(
  mask: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const out = Float32Array.from(mask);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] !== 1) continue;
      for (let yy = Math.max(0, y - radius); yy <= Math.min(height - 1, y + radius); yy++)
        for (let xx = Math.max(0, x - radius); xx <= Math.min(width - 1, x + radius); xx++)
          out[yy * width + xx] = 1;
    }
  }
  return out;
}

/**
 * Pitch suitability 0..1 per cell: gentle slope, smooth ground and (when known) no tall
 * vegetation, multiplied so that any one failing criterion rules the cell out.
 * (Runs on every slider move over millions of cells, so the fades are inlined.)
 */
export function pitchSuitability(
  slope: Float32Array,
  rough: Float32Array,
  canopy?: Float32Array,
  s: SuitabilityParams = DEFAULT_SUITABILITY,
  water?: Float32Array,
): Float32Array {
  const out = new Float32Array(slope.length);
  const slopeSpan = 1 / (s.slopeMaxDeg - s.slopeOkDeg);
  const roughSpan = 1 / (s.roughMaxM - s.roughOkM);
  const canopySpan = 1 / (s.canopyMaxM - s.canopyOkM);
  /** 1 - smoothstep: 1 up to the ok value, 0 from the max value on. */
  const fade = (v: number, ok: number, span: number): number => {
    const t = (v - ok) * span;
    return t <= 0 ? 1 : t >= 1 ? 0 : 1 - t * t * (3 - 2 * t);
  };
  for (let i = 0; i < out.length; i++) {
    const sl = slope[i]!;
    const r = rough[i]!;
    if (sl !== sl || r !== r) {
      out[i] = Number.NaN;
      continue;
    }
    if (water && water[i] === 1) continue; // 0
    let v = fade(sl, s.slopeOkDeg, slopeSpan);
    if (v > 0) v *= fade(r, s.roughOkM, roughSpan);
    if (v > 0 && canopy) {
      const c = canopy[i]!;
      if (c === c) v *= fade(c, s.canopyOkM, canopySpan);
    }
    out[i] = v;
  }
  return out;
}

/**
 * Keeps a cell only if every cell within `radius` cells is at least as suitable: a pitch
 * needs a whole patch of good ground, not a single lucky cell. NaN and cells beyond the
 * border count as unsuitable. (A separable minimum: one pass along rows, one along columns.)
 */
export function patchMinimum(
  data: Float32Array,
  width: number,
  height: number,
  radius: number,
): Float32Array {
  const rows = new Float32Array(data.length);
  for (let y = 0; y < height; y++) {
    const base = y * width;
    for (let x = radius; x < width - radius; x++) {
      let m = Infinity;
      for (let k = base + x - radius, end = base + x + radius; k <= end; k++) {
        const v = data[k]!;
        if (!(v >= m)) m = v === v ? v : 0; // a NaN counts as 0
      }
      rows[base + x] = m;
    }
  }
  const out = new Float32Array(data.length);
  for (let y = radius; y < height - radius; y++) {
    for (let x = 0; x < width; x++) {
      let m = Infinity;
      for (let k = (y - radius) * width + x, end = (y + radius) * width + x; k <= end; k += width) {
        const v = rows[k]!;
        if (v < m) m = v;
      }
      out[y * width + x] = m;
    }
  }
  return out;
}
