import type { PanoramaScene, Ridgeline } from '../horizon/scene';
import { bandOf } from './depth';

export interface IndexedRidge {
  ridge: Ridgeline;
  /** Stable per scene; use for seeding. */
  id: number;
  /** Azimuth of point 0; point i is at az0 + i·azStep (unwrapped, may pass 360). */
  az0: number;
  /** Median distance of the ridge, meters. */
  dist: number;
  band: number;
  /**
   * For each point, the angle of the next nearer crest below it in the same ray (the
   * lower edge of the terrain this crest "owns" in the image), or -90 if none.
   */
  below: Float32Array;
}

export interface SceneIndex {
  /** Far to near: the painter's order. */
  ridges: IndexedRidge[];
  azStep: number;
  /** Per ray: angle of the lowest (nearest) kept crest, or the horizon angle if none. */
  lowest: Float32Array;
}

const cache = new WeakMap<PanoramaScene, SceneIndex>();

/** Precomputes per-ridge data the styles need; cached per scene. */
export function indexScene(scene: PanoramaScene): SceneIndex {
  const hit = cache.get(scene);
  if (hit) return hit;
  const step = scene.azStep;
  const n = scene.horizonAngle.length;

  const ridges: IndexedRidge[] = scene.ridgelines.map((ridge, id) => {
    const d = ridge.points.map((p) => p.dist).sort((a, b) => a - b);
    const dist = d[d.length >> 1] ?? 0;
    return {
      ridge,
      id,
      az0: ridge.points[0]?.az ?? 0,
      dist,
      band: bandOf(dist),
      below: new Float32Array(ridge.points.length).fill(-90),
    };
  });

  // Per ray, visible crests sorted by angle are also sorted by distance (a crest is only
  // visible if it rises above everything nearer), so "below" is the next lower one.
  const perRay: { angle: number; r: IndexedRidge; i: number }[][] = Array.from(
    { length: n },
    () => [],
  );
  for (const r of ridges) {
    r.ridge.points.forEach((p, i) => {
      const ray = ((Math.round(p.az / step) % n) + n) % n;
      perRay[ray]!.push({ angle: p.angle, r, i });
    });
  }
  const lowest = new Float32Array(n);
  perRay.forEach((list, ray) => {
    list.sort((a, b) => b.angle - a.angle);
    for (let k = 0; k + 1 < list.length; k++) list[k]!.r.below[list[k]!.i] = list[k + 1]!.angle;
    lowest[ray] = list.length ? list[list.length - 1]!.angle : scene.horizonAngle[ray]!;
  });

  const index = { ridges: ridges.sort((a, b) => b.dist - a.dist), azStep: step, lowest };
  cache.set(scene, index);
  return index;
}

export interface RidgeRun {
  r: IndexedRidge;
  /** Point range [i0, i1] inside the slice (inclusive). */
  i0: number;
  i1: number;
  /** Unwrapped azimuth of point i is az0 + i·azStep + shift. */
  shift: number;
}

/**
 * Parts of ridges within [azStart - margin, azEnd + margin] (azStart in [0, 360),
 * azEnd may exceed 360). O(1) per ridge; a ridge may yield several runs across the seam.
 */
export function ridgeRuns(
  index: SceneIndex,
  azStart: number,
  azEnd: number,
  marginDeg: number,
): RidgeRun[] {
  const out: RidgeRun[] = [];
  const step = index.azStep;
  const lo = azStart - marginDeg;
  const hi = azEnd + marginDeg;
  for (const r of index.ridges) {
    const last = r.ridge.points.length - 1;
    for (const shift of [-360, 0, 360, 720]) {
      const a0 = r.az0 + shift;
      const i0 = Math.max(0, Math.ceil((lo - a0) / step - 1e-9));
      const i1 = Math.min(last, Math.floor((hi - a0) / step + 1e-9));
      if (i0 <= i1) out.push({ r, i0, i1, shift });
    }
  }
  return out;
}
