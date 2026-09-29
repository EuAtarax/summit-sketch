import type { PackedRidges } from './link';
import { DEFAULT_HORIZON_OPTIONS, rayCountFor, type HorizonOptions } from './pipeline';
import type { FromWorker, ToWorker } from './protocol';
import { mergeCastResults, type CastResult } from './rayCast';
import { unpackRidges, type Observer, type PanoramaScene } from './scene';
import type { SnapResult } from '../terrain/snap';

export type EngineProgress =
  | { stage: 'terrain'; loaded: number; total: number }
  | { stage: 'tracing'; done: number; total: number }
  | { stage: 'linking' };

export interface EngineStats {
  workers: number;
  tiles: number;
  loadMs: number;
  totalMs: number;
  ridgelines: number;
}

export interface EngineRun {
  promise: Promise<{ scene: PanoramaScene; stats: EngineStats }>;
  cancel(): void;
}

export class CancelledComputeError extends Error {
  constructor() {
    super('Computation cancelled');
    this.name = 'CancelledComputeError';
  }
}

export function defaultWorkerCount(): number {
  return Math.max(1, Math.min(navigator.hardwareConcurrency || 2, 4));
}

type Handler = (msg: FromWorker, worker: number) => void;

/**
 * Splits the azimuth range across a persistent pool of workers. Each worker fetches and
 * decodes its own tiles (and keeps them cached), casts its rays, and one worker links the
 * merged crests into ridgelines.
 */
export class HorizonEngine {
  private readonly workers: Worker[] = [];
  private handler: Handler | null = null;
  private nextJob = 1;
  private active: EngineRun | null = null;
  private readonly snaps = new Map<
    number,
    { resolve: (r: SnapResult) => void; reject: (e: Error) => void }
  >();

  constructor(private readonly size = defaultWorkerCount()) {}

  private pool(): Worker[] {
    while (this.workers.length < this.size) {
      const index = this.workers.length;
      const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<FromWorker>) => {
        const msg = e.data;
        const snap = this.snaps.get(msg.job);
        if (snap) {
          this.snaps.delete(msg.job);
          if (msg.type === 'snap-done') snap.resolve(msg.result);
          else if (msg.type === 'error') snap.reject(new Error(msg.message));
          return;
        }
        this.handler?.(msg, index);
      };
      w.onerror = (e) => {
        e.preventDefault();
        for (const s of this.snaps.values()) s.reject(new Error(e.message));
        this.snaps.clear();
        this.handler?.({ type: 'error', job: -1, message: e.message, cancelled: false }, index);
      };
      this.workers.push(w);
    }
    return this.workers;
  }

  /** DEM elevation at exactly this point, decoded off the main thread. */
  elevation(lat: number, lon: number): Promise<SnapResult> {
    return this.snap(lat, lon, 0);
  }

  /**
   * Moves a point to the highest DEM cell within radiusM (0 = keep the point), decoding off
   * the main thread.
   */
  snap(lat: number, lon: number, radiusM = 150): Promise<SnapResult> {
    const job = this.nextJob++;
    const worker = this.pool()[0]!;
    return new Promise((resolve, reject) => {
      this.snaps.set(job, { resolve, reject });
      const msg: ToWorker = { type: 'snap', job, lat, lon, radiusM };
      worker.postMessage(msg);
    });
  }

  compute(
    observer: Observer,
    options: Partial<HorizonOptions>,
    onProgress: (p: EngineProgress) => void,
  ): EngineRun {
    const o: HorizonOptions = { ...DEFAULT_HORIZON_OPTIONS, ...options };
    // One computation at a time: a new one supersedes the previous.
    this.active?.cancel();
    const job = this.nextJob++;
    const workers = this.pool();
    const rayTotal = rayCountFor(o.azStep);
    const n = workers.length;
    const t0 = performance.now();

    const send = (w: Worker, msg: ToWorker, transfer: Transferable[] = []) =>
      w.postMessage(msg, transfer);

    let settle: {
      resolve: (v: { scene: PanoramaScene; stats: EngineStats }) => void;
      reject: (e: Error) => void;
    };
    const promise = new Promise<{ scene: PanoramaScene; stats: EngineStats }>((resolve, reject) => {
      settle = { resolve, reject };
    });

    const loaded = new Array<number>(n).fill(0);
    const totals = new Array<number>(n).fill(-1);
    const rays = new Array<number>(n).fill(0);
    const parts: CastResult[] = [];
    let loadMs = 0;
    let finished = false;
    let handler: Handler | null = null;

    const finish = (err: Error | null, value?: { scene: PanoramaScene; stats: EngineStats }) => {
      if (finished) return;
      finished = true;
      if (this.handler === handler) this.handler = null;
      if (this.active === run) this.active = null;
      if (err) settle.reject(err);
      else settle.resolve(value!);
    };

    const onLinked = (ridges: PackedRidges, cast: CastResult) => {
      const scene: PanoramaScene = {
        observer,
        azStep: o.azStep,
        radiusM: o.radiusM,
        horizonAngle: cast.horizonAngle,
        horizonDist: cast.horizonDist,
        ridgelines: unpackRidges(ridges),
        sea: {
          offsets: cast.seaOffsets,
          lo: cast.seaLo,
          hi: cast.seaHi,
          loDist: cast.seaLoDist,
          hiDist: cast.seaHiDist,
        },
      };
      finish(null, {
        scene,
        stats: {
          workers: n,
          tiles: totals.reduce((s, t) => s + Math.max(t, 0), 0),
          loadMs,
          totalMs: performance.now() - t0,
          ridgelines: scene.ridgelines.length,
        },
      });
    };

    let merged: CastResult | null = null;
    handler = (msg, wi) => {
      if (finished) return;
      // Ignore stale messages from a cancelled job; job -1 is a worker crash.
      if (msg.job !== job && msg.job !== -1) return;
      switch (msg.type) {
        case 'tiles':
          loaded[wi] = msg.loaded;
          totals[wi] = msg.total;
          if (totals.every((t) => t >= 0)) {
            const l = loaded.reduce((s, x) => s + x, 0);
            const t = totals.reduce((s, x) => s + x, 0);
            onProgress({ stage: 'terrain', loaded: l, total: t });
          }
          break;
        case 'rays':
          if (!loadMs) loadMs = performance.now() - t0;
          rays[wi] = msg.done;
          onProgress({ stage: 'tracing', done: rays.reduce((s, x) => s + x, 0), total: rayTotal });
          break;
        case 'cast-done':
          if (!loadMs) loadMs = performance.now() - t0;
          parts.push(msg.result);
          if (parts.length === n) {
            onProgress({ stage: 'linking' });
            merged = mergeCastResults(parts);
            const table = {
              rayCount: merged.rayCount,
              azStep: o.azStep,
              fullCircle: true,
              crestOffsets: merged.crestOffsets.slice(),
              crestAngle: merged.crestAngle.slice(),
              crestDist: merged.crestDist.slice(),
              crestElev: merged.crestElev.slice(),
            };
            send(workers[0]!, { type: 'link', job, table, options: o.link }, [
              table.crestOffsets.buffer,
              table.crestAngle.buffer,
              table.crestDist.buffer,
              table.crestElev.buffer,
            ]);
          }
          break;
        case 'link-done':
          onLinked(msg.ridges, merged!);
          break;
        case 'error':
          finish(msg.cancelled ? new CancelledComputeError() : new Error(msg.message));
          break;
      }
    };

    this.handler = handler;

    // Contiguous azimuth sectors, one per worker.
    for (let i = 0; i < n; i++) {
      const rayStart = Math.floor((i * rayTotal) / n);
      const rayEnd = Math.floor(((i + 1) * rayTotal) / n);
      send(workers[i]!, {
        type: 'cast',
        job,
        observer,
        options: o,
        rayStart,
        rayCount: rayEnd - rayStart,
      });
    }

    const run: EngineRun = {
      promise,
      cancel: () => {
        if (finished) return;
        for (const w of workers) send(w, { type: 'cancel', job });
        finish(new CancelledComputeError());
      },
    };
    this.active = run;
    return run;
  }
}
