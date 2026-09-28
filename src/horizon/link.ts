export interface LinkOptions {
  /** Max relative distance difference between linked crests, e.g. 0.06 = 6 %. */
  maxRelDist: number;
  /** Max elevation-angle difference between linked crests, degrees. */
  maxAngleDiff: number;
  /** Ridgelines spanning less azimuth than this are dropped, degrees. */
  minSpanDeg: number;
}

export const DEFAULT_LINK_OPTIONS: LinkOptions = {
  maxRelDist: 0.06,
  maxAngleDiff: 0.3,
  minSpanDeg: 0.5,
};

export interface CrestTable {
  /** Total rays; ray r has azimuth r·azStep. */
  rayCount: number;
  azStep: number;
  /** True if the rays cover the full circle, so the last ray neighbors ray 0. */
  fullCircle: boolean;
  crestOffsets: Uint32Array;
  crestAngle: Float32Array;
  crestDist: Float32Array;
  crestElev: Float32Array;
}

/** Linked ridgelines in flat arrays: ridge i owns points offsets[i] .. offsets[i + 1] - 1. */
export interface PackedRidges {
  offsets: Uint32Array;
  az: Float32Array;
  angle: Float32Array;
  dist: Float32Array;
  elev: Float32Array;
}

/**
 * Greedily matches crests on neighboring rays (best score first, each crest used once)
 * when both relative distance and angle are within thresholds, then joins ridges across
 * the 0°/360° seam and drops short ones.
 */
export function linkRidges(t: CrestTable, o: LinkOptions = DEFAULT_LINK_OPTIONS): PackedRidges {
  const { rayCount, crestOffsets: off, crestAngle: ang, crestDist: dst } = t;
  const crestCount = off[rayCount]!;
  // ridges[i] is a list of crest indices in ray order.
  const ridges: number[][] = [];
  const ridgeOf = new Int32Array(crestCount).fill(-1);
  const crestRay = new Uint32Array(crestCount);
  for (let r = 0; r < rayCount; r++) {
    for (let c = off[r]!; c < off[r + 1]!; c++) crestRay[c] = r;
  }

  /** Candidate pairs (a on one ray, b on the next), best first. */
  const match = (
    aStart: number,
    aEnd: number,
    bStart: number,
    bEnd: number,
  ): [number, number][] => {
    const pairs: { a: number; b: number; score: number }[] = [];
    for (let b = bStart; b < bEnd; b++) {
      const db = dst[b]!;
      for (let a = aStart; a < aEnd; a++) {
        const da = dst[a]!;
        const rel = Math.abs(da - db) / Math.min(da, db);
        if (rel >= o.maxRelDist) continue;
        const dAng = Math.abs(ang[a]! - ang[b]!);
        if (dAng >= o.maxAngleDiff) continue;
        pairs.push({ a, b, score: rel / o.maxRelDist + dAng / o.maxAngleDiff });
      }
    }
    pairs.sort((x, y) => x.score - y.score);
    const usedA = new Set<number>();
    const usedB = new Set<number>();
    const out: [number, number][] = [];
    for (const { a, b } of pairs) {
      if (usedA.has(a) || usedB.has(b)) continue;
      usedA.add(a);
      usedB.add(b);
      out.push([a, b]);
    }
    return out;
  };

  for (let r = 0; r < rayCount; r++) {
    if (r > 0) {
      for (const [a, b] of match(off[r - 1]!, off[r]!, off[r]!, off[r + 1]!)) {
        const ri = ridgeOf[a]!;
        ridges[ri]!.push(b);
        ridgeOf[b] = ri;
      }
    }
    for (let c = off[r]!; c < off[r + 1]!; c++) {
      if (ridgeOf[c] === -1) {
        ridgeOf[c] = ridges.length;
        ridges.push([c]);
      }
    }
  }

  // Join ridges across the seam: a ridge ending on the last ray continues into a ridge
  // starting on ray 0.
  const next = new Int32Array(ridges.length).fill(-1);
  const hasPrev = new Uint8Array(ridges.length);
  if (t.fullCircle && rayCount > 1) {
    const last = rayCount - 1;
    for (const [a, b] of match(off[last]!, off[last + 1]!, off[0]!, off[1]!)) {
      const ra = ridgeOf[a]!;
      const rb = ridgeOf[b]!;
      if (ra === rb) continue; // a ridge that already runs all the way around
      next[ra] = rb;
      hasPrev[rb] = 1;
    }
  }

  const chains: number[][] = [];
  const visited = new Uint8Array(ridges.length);
  const follow = (start: number) => {
    const chain: number[] = [];
    for (let r = start; r !== -1 && !visited[r]; r = next[r]!) {
      visited[r] = 1;
      chain.push(...ridges[r]!);
    }
    chains.push(chain);
  };
  for (let r = 0; r < ridges.length; r++) if (!hasPrev[r]) follow(r);
  for (let r = 0; r < ridges.length; r++) if (!visited[r]) follow(r); // cycles

  const minPoints = Math.ceil(o.minSpanDeg / t.azStep - 1e-9) + 1;
  const kept = chains.filter((c) => c.length >= minPoints);
  const total = kept.reduce((s, c) => s + c.length, 0);
  const out: PackedRidges = {
    offsets: new Uint32Array(kept.length + 1),
    az: new Float32Array(total),
    angle: new Float32Array(total),
    dist: new Float32Array(total),
    elev: new Float32Array(total),
  };
  let i = 0;
  kept.forEach((chain, k) => {
    out.offsets[k] = i;
    for (const c of chain) {
      out.az[i] = crestRay[c]! * t.azStep;
      out.angle[i] = ang[c]!;
      out.dist[i] = dst[c]!;
      out.elev[i] = t.crestElev[c]!;
      i++;
    }
  });
  out.offsets[kept.length] = i;
  return out;
}
