import { REFRACTION_K } from '../geo/geodesy';
import type { ElevationSource } from '../terrain/source';
import { TileGrid } from '../terrain/tileGrid';
import { DEFAULT_LINK_OPTIONS, linkRidges, type LinkOptions } from './link';
import { castRays, mergeCastResults, type CastResult } from './rayCast';
import {
  buildRaySamples,
  DEFAULT_ZOOM_BANDS,
  requiredTiles,
  type RaySamples,
  type ZoomBand,
} from './sampling';
import { unpackRidges, type Observer, type PanoramaScene } from './scene';

export interface HorizonOptions {
  radiusM: number;
  azStep: number;
  zoomBands: readonly ZoomBand[];
  refractionK: number;
  stepFactor: number;
  minCrestDropDeg: number;
  clampSeaLevel: boolean;
  link: LinkOptions;
}

export const DEFAULT_HORIZON_OPTIONS: HorizonOptions = {
  radiusM: 200_000,
  azStep: 0.1,
  zoomBands: DEFAULT_ZOOM_BANDS,
  refractionK: REFRACTION_K,
  stepFactor: 0.5,
  minCrestDropDeg: 0.03,
  clampSeaLevel: true,
  link: DEFAULT_LINK_OPTIONS,
};

export function rayCountFor(azStep: number): number {
  return Math.round(360 / azStep);
}

export function samplesFor(observer: Observer, o: HorizonOptions, maxZoom: number): RaySamples {
  return buildRaySamples(observer.lat, o.radiusM, {
    zoomBands: o.zoomBands,
    refractionK: o.refractionK,
    stepFactor: o.stepFactor,
    maxZoom,
  });
}

export interface LoadHooks {
  onTile?: (loaded: number, total: number) => void;
  isCancelled?: () => boolean;
  concurrency?: number;
  onRays?: (raysDone: number) => void;
}

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Loads every tile the given rays need into one TileGrid per band. */
export async function loadGrids(
  source: ElevationSource,
  observer: Observer,
  samples: RaySamples,
  azStep: number,
  rayStart: number,
  rayCount: number,
  hooks: LoadHooks = {},
): Promise<TileGrid[]> {
  const perBand = requiredTiles(observer.lat, observer.lon, samples, azStep, rayStart, rayCount);
  const grids = samples.bands.map((b) => new TileGrid(b.zoom));
  const jobs = perBand.flatMap((tiles, bi) => tiles.map((t) => ({ bi, ...t })));
  const total = jobs.length;
  let loaded = 0;
  let nextJob = 0;
  hooks.onTile?.(0, total);
  const worker = async () => {
    while (nextJob < jobs.length) {
      if (hooks.isCancelled?.()) throw new CancelledError();
      const job = jobs[nextJob++]!;
      const grid = grids[job.bi]!;
      grid.set(job.x, job.y, await source.getTile(grid.z, job.x, job.y));
      hooks.onTile?.(++loaded, total);
    }
  };
  await Promise.all(Array.from({ length: Math.min(hooks.concurrency ?? 4, total) }, worker));
  return grids;
}

/** Loads terrain for a range of rays and casts them. */
export async function castSector(
  source: ElevationSource,
  observer: Observer,
  o: HorizonOptions,
  rayStart: number,
  rayCount: number,
  hooks: LoadHooks = {},
): Promise<CastResult> {
  const samples = samplesFor(observer, o, source.maxZoom);
  const grids = await loadGrids(source, observer, samples, o.azStep, rayStart, rayCount, hooks);
  return castRays({
    lat: observer.lat,
    lon: observer.lon,
    observerHeight: observer.groundElev + observer.eyeHeight,
    azStep: o.azStep,
    rayStart,
    rayCount,
    samples,
    grids,
    minCrestDropDeg: o.minCrestDropDeg,
    clampSeaLevel: o.clampSeaLevel,
    ...(hooks.onRays ? { onProgress: hooks.onRays } : {}),
  });
}

/** Builds the scene from cast results that together cover all rays. */
export function assembleScene(
  observer: Observer,
  o: HorizonOptions,
  parts: CastResult[],
): PanoramaScene {
  const cast = mergeCastResults(parts);
  const ridges = linkRidges(
    { ...cast, azStep: o.azStep, fullCircle: cast.rayCount === rayCountFor(o.azStep) },
    o.link,
  );
  return {
    observer,
    azStep: o.azStep,
    radiusM: o.radiusM,
    horizonAngle: cast.horizonAngle,
    horizonDist: cast.horizonDist,
    ridgelines: unpackRidges(ridges),
  };
}

/** Single-threaded full pipeline. The app uses workers (see engine.ts); tests use this. */
export async function computeScene(
  source: ElevationSource,
  observer: Observer,
  options: Partial<HorizonOptions> = {},
): Promise<PanoramaScene> {
  const o = { ...DEFAULT_HORIZON_OPTIONS, ...options };
  const cast = await castSector(source, observer, o, 0, rayCountFor(o.azStep));
  return assembleScene(observer, o, [cast]);
}
