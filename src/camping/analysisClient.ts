import type { LayerId } from './heatmap';
import type { ScoreSettings, SpotView } from './model';
import type { DrinkingSource } from './osm';
import type { PaletteId } from './palettes';
import type { AnalysisParams, AreaInfo, Progress } from './pipeline';
import type { GridGeometry } from './terrain';

/** What the page needs to know about a finished analysis; the grids stay in the worker. */
export interface ResultSummary {
  geometry: GridGeometry;
  areas: AreaInfo[];
  drinking: DrinkingSource[];
  warnings: string[];
  /** The protected area at the analysed point itself, if any. */
  areaAtCenter: AreaInfo | null;
  millis: number;
}

/** The best spots and the heatmap image for the current settings. */
export interface ViewUpdate {
  spots: SpotView[];
  /** A PNG of the layer, or null when this analysis has no such data. */
  overlay: { blob: Blob; bounds: [[number, number], [number, number]] } | null;
}

export type WorkerRequest =
  | { type: 'analyse'; id: number; params: AnalysisParams }
  | { type: 'view'; id: number; settings: ScoreSettings; layer: LayerId; palette: PaletteId }
  | { type: 'describe'; id: number; lat: number; lon: number };

export type WorkerResponse =
  | ({ type: 'progress'; id: number } & Progress)
  | { type: 'result'; id: number; summary: ResultSummary }
  /** `view` is null when a newer request replaced this one or there is no analysis yet. */
  | { type: 'view'; id: number; view: ViewUpdate | null }
  | { type: 'describe'; id: number; text: string | null }
  | { type: 'error'; id: number; message: string };

/** Thrown into the promise of a request that a newer one replaced. */
export class SupersededError extends Error {
  constructor() {
    super('Analysis superseded');
    this.name = 'SupersededError';
  }
}

interface Pending {
  resolve: (value: never) => void;
  reject: (e: Error) => void;
  onProgress: ((p: Progress) => void) | undefined;
}

/**
 * Talks to the analysis worker, which downloads and analyses the terrain and then keeps the
 * grids: rescoring, painting the heatmap and the hover readout all run there, so the page
 * never blocks. Only the latest analysis matters: starting a new one stops the running one by
 * ending its worker (the terrain files stay in the service worker and HTTP caches).
 */
export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private analysisId = 0;
  private readonly pending = new Map<number, Pending>();

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
      worker.onerror = (e) => {
        this.rejectAll(new Error(e.message || 'The analysis worker crashed'));
        this.worker = null;
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private rejectAll(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private handle(msg: WorkerResponse): void {
    const p = this.pending.get(msg.id);
    if (!p) return; // from a worker that was replaced
    if (msg.type === 'progress') {
      p.onProgress?.(msg);
      return;
    }
    this.pending.delete(msg.id);
    if (msg.type === 'error') p.reject(new Error(msg.message));
    else if (msg.type === 'result') p.resolve(msg.summary as never);
    else if (msg.type === 'view') p.resolve(msg.view as never);
    else p.resolve(msg.text as never);
  }

  private request<T>(
    make: (id: number) => WorkerRequest,
    onProgress?: (p: Progress) => void,
  ): Promise<T> {
    const id = this.nextId++;
    const worker = this.ensureWorker();
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress });
      worker.postMessage(make(id));
    });
  }

  /** Analyses an area; a running analysis is stopped (its promise rejects with SupersededError). */
  run(params: AnalysisParams, onProgress: (p: Progress) => void): Promise<ResultSummary> {
    if (this.pending.has(this.analysisId)) {
      this.rejectAll(new SupersededError());
      this.worker?.terminate();
      this.worker = null;
    }
    return this.request<ResultSummary>((id) => {
      this.analysisId = id;
      return { type: 'analyse', id, params };
    }, onProgress);
  }

  /** Best spots and heatmap for these settings; null if a newer request replaced this one. */
  view(settings: ScoreSettings, layer: LayerId, palette: PaletteId): Promise<ViewUpdate | null> {
    return this.request((id) => ({ type: 'view', id, settings, layer, palette }));
  }

  /** The numbers behind the cell at a position, or null outside the analysed area. */
  describe(lat: number, lon: number): Promise<string | null> {
    return this.request((id) => ({ type: 'describe', id, lat, lon }));
  }
}
