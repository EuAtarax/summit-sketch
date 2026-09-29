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

/** Yield to the event loop after this many milliseconds of synchronous work. */
const CHUNK_MS = 10;

/**
 * Builds the lookup in small steps: it yields between chunks so an async driver can give
 * the main thread back, and a sync driver simply runs it to the end.
 */
function* buildLookup(scene: PanoramaScene): Generator<void, CrestLookup> {
  const rayCount = scene.horizonAngle.length;
  const entries: [number, number][][] = Array.from({ length: rayCount }, () => []);
  let count = 0;
  for (const ridge of scene.ridgelines) {
    for (const p of ridge.points) {
      entries[rayOf(p.az, scene.azStep, rayCount)]!.push([p.dist, p.angle]);
      if (++count % 4096 === 0) yield;
    }
  }
  const lookup: CrestLookup = { dist: [], angle: [] };
  for (const [ray, list] of entries.entries()) {
    list.sort((a, b) => a[0] - b[0]);
    lookup.dist.push(list.map((e) => e[0]));
    lookup.angle.push(list.map((e) => e[1]));
    if (ray % 64 === 63) yield;
  }
  return lookup;
}

/** Groups the scene's ridge points by ray and sorts each ray by distance. Cached per scene. */
export function crestLookup(scene: PanoramaScene): CrestLookup {
  const hit = lookups.get(scene);
  if (hit) return hit;
  const steps = buildLookup(scene);
  let step = steps.next();
  while (!step.done) step = steps.next();
  lookups.set(scene, step.value);
  return step.value;
}

/** Builds the cached lookup without blocking the main thread for more than ~10 ms at a time. */
export async function prepareCrestLookup(scene: PanoramaScene): Promise<void> {
  if (lookups.has(scene)) return;
  const steps = buildLookup(scene);
  let chunkStart = performance.now();
  for (;;) {
    const step = steps.next();
    if (step.done) {
      lookups.set(scene, step.value);
      return;
    }
    if (performance.now() - chunkStart > CHUNK_MS) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      chunkStart = performance.now();
    }
  }
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
