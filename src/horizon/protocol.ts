import type { CrestTable, LinkOptions, PackedRidges } from './link';
import type { HorizonOptions } from './pipeline';
import type { CastResult } from './rayCast';
import type { Observer } from './scene';
import type { SnapResult } from '../terrain/snap';

/** One DEM lookup: the highest cell within a small radius of the point, at a given zoom. */
export interface ElevationQuery {
  lat: number;
  lon: number;
  zoom: number;
}

export type ToWorker =
  | {
      type: 'cast';
      job: number;
      observer: Observer;
      options: HorizonOptions;
      rayStart: number;
      rayCount: number;
    }
  | { type: 'link'; job: number; table: CrestTable; options: LinkOptions }
  | { type: 'snap'; job: number; lat: number; lon: number; radiusM: number }
  | { type: 'elevations'; job: number; points: ElevationQuery[] }
  | { type: 'cancel'; job: number };

export type FromWorker =
  | { type: 'tiles'; job: number; loaded: number; total: number }
  | { type: 'rays'; job: number; done: number }
  | { type: 'cast-done'; job: number; result: CastResult }
  | { type: 'link-done'; job: number; ridges: PackedRidges }
  | { type: 'snap-done'; job: number; result: SnapResult }
  | { type: 'elevations-done'; job: number; elevations: Float32Array }
  | { type: 'error'; job: number; message: string; cancelled: boolean };
