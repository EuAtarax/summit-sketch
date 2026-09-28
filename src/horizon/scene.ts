import type { PackedRidges } from './link';

export interface RidgePoint {
  az: number; // degrees
  angle: number; // degrees
  dist: number; // meters
  elev: number; // meters
}

export interface Ridgeline {
  points: RidgePoint[];
  minDist: number;
  maxDist: number;
}

export interface Observer {
  lat: number;
  lon: number;
  groundElev: number;
  eyeHeight: number;
  name?: string;
}

export interface PanoramaScene {
  observer: Observer;
  azStep: number; // degrees between rays
  radiusM: number;
  horizonAngle: Float32Array; // outermost visible angle per ray
  horizonDist: Float32Array; // distance of that outermost visible crest per ray
  ridgelines: Ridgeline[]; // all visible crests, linked across rays
}

export function unpackRidges(p: PackedRidges): Ridgeline[] {
  const out: Ridgeline[] = [];
  for (let k = 0; k + 1 < p.offsets.length; k++) {
    const points: RidgePoint[] = [];
    let minDist = Infinity;
    let maxDist = 0;
    for (let i = p.offsets[k]!; i < p.offsets[k + 1]!; i++) {
      const dist = p.dist[i]!;
      points.push({ az: p.az[i]!, angle: p.angle[i]!, dist, elev: p.elev[i]! });
      if (dist < minDist) minDist = dist;
      if (dist > maxDist) maxDist = dist;
    }
    out.push({ points, minDist, maxDist });
  }
  return out;
}
