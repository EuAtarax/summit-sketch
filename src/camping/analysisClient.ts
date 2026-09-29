import type { AnalysisParams, AnalysisResult, Progress } from './pipeline';

export type WorkerRequest = { id: number; params: AnalysisParams };
export type WorkerResponse =
  | ({ type: 'progress'; id: number } & Progress)
  | { type: 'result'; id: number; result: AnalysisResult }
  | { type: 'error'; id: number; message: string };

/** Thrown into the promise of an analysis that a newer one replaced. */
export class SupersededError extends Error {
  constructor() {
    super('Analysis superseded');
    this.name = 'SupersededError';
  }
}

/**
 * Runs analyses in a Web Worker so downloading and number crunching never block the page.
 * Only the latest request matters: starting a new one supersedes the running one, whose
 * result is ignored (its downloads finish in the background and stay cached).
 */
export class AnalysisClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private current: {
    id: number;
    resolve: (r: AnalysisResult) => void;
    reject: (e: Error) => void;
    onProgress: (p: Progress) => void;
  } | null = null;

  private ensureWorker(): Worker {
    if (!this.worker) {
      const worker = new Worker(new URL('./analysisWorker.ts', import.meta.url), {
        type: 'module',
      });
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => this.handle(e.data);
      worker.onerror = (e) => {
        this.current?.reject(new Error(e.message || 'The analysis worker crashed'));
        this.current = null;
        this.worker = null;
      };
      this.worker = worker;
    }
    return this.worker;
  }

  private handle(msg: WorkerResponse): void {
    const current = this.current;
    if (!current || msg.id !== current.id) return; // stale message from a superseded run
    if (msg.type === 'progress') {
      current.onProgress(msg);
    } else {
      this.current = null;
      if (msg.type === 'result') current.resolve(msg.result);
      else current.reject(new Error(msg.message));
    }
  }

  run(params: AnalysisParams, onProgress: (p: Progress) => void): Promise<AnalysisResult> {
    this.current?.reject(new SupersededError());
    const id = this.nextId++;
    const worker = this.ensureWorker();
    return new Promise((resolve, reject) => {
      this.current = { id, resolve, reject, onProgress };
      worker.postMessage({ id, params } satisfies WorkerRequest);
    });
  }
}
