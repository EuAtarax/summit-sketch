import type { CrestTable, LinkOptions, PackedRidges } from './link';
import type { HorizonOptions } from './pipeline';
import type { CastResult } from './rayCast';
import type { Observer } from './scene';
import type { SnapResult } from '../terrain/snap';

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
  | { type: 'cancel'; job: number };

export type FromWorker =
  | { type: 'tiles'; job: number; loaded: number; total: number }
  | { type: 'rays'; job: number; done: number }
  | { type: 'cast-done'; job: number; result: CastResult }
  | { type: 'link-done'; job: number; ridges: PackedRidges }
  | { type: 'snap-done'; job: number; result: SnapResult }
  | { type: 'error'; job: number; message: string; cancelled: boolean };
