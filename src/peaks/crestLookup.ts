import type { PanoramaScene } from '../horizon/scene';

/** Visible crests per ray, near to far. Angles rise with distance by construction. */
export interface CrestLookup {
  dist: number[][];
  angle: number[][];
}

const lookups = new WeakMap<PanoramaScene, CrestLookup>();

export function rayOf(az: number, azStep: number, rayCount: number): number {
  return ((Math.round(az / azStep) % rayCount) + rayCount) % rayCount;
}

/** Groups the scene's ridge points by ray and sorts each ray by distance. Cached per scene. */
export function crestLookup(scene: PanoramaScene): CrestLookup {
  const hit = lookups.get(scene);
  if (hit) return hit;
  const rayCount = scene.horizonAngle.length;
  const entries: [number, number][][] = Array.from({ length: rayCount }, () => []);
  for (const ridge of scene.ridgelines) {
    for (const p of ridge.points) {
      entries[rayOf(p.az, scene.azStep, rayCount)]!.push([p.dist, p.angle]);
    }
  }
  const lookup: CrestLookup = { dist: [], angle: [] };
  for (const list of entries) {
    list.sort((a, b) => a[0] - b[0]);
    lookup.dist.push(list.map((e) => e[0]));
    lookup.angle.push(list.map((e) => e[1]));
  }
  lookups.set(scene, lookup);
  return lookup;
}

/**
 * Highest apparent angle of any visible crest on the ray nearer than limitDist, or -Infinity
 * when nothing stands in front. This is the running max of the ray cast at that distance.
 */
export function runningMaxAngle(scene: PanoramaScene, az: number, limitDist: number): number {
  const lookup = crestLookup(scene);
  const ray = rayOf(az, scene.azStep, scene.horizonAngle.length);
  const dists = lookup.dist[ray]!;
  // Last crest with dist < limitDist (binary search on the sorted distances).
  let lo = 0;
  let hi = dists.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dists[mid]! < limitDist) lo = mid + 1;
    else hi = mid;
  }
  return lo === 0 ? -Infinity : lookup.angle[ray]![lo - 1]!;
}

/** Lowest crest angle within [distLo, distHi] on the ray at az, or null if there is none. */
export function lowestCrestAngleInBand(
  scene: PanoramaScene,
  az: number,
  distLo: number,
  distHi: number,
): number | null {
  const lookup = crestLookup(scene);
  const ray = rayOf(az, scene.azStep, scene.horizonAngle.length);
  const dists = lookup.dist[ray]!;
  const angles = lookup.angle[ray]!;
  let lowest: number | null = null;
  for (let i = 0; i < dists.length; i++) {
    const d = dists[i]!;
    if (d < distLo) continue;
    if (d > distHi) break;
    if (lowest === null || angles[i]! < lowest) lowest = angles[i]!;
  }
  return lowest;
}
