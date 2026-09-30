/// <reference lib="webworker" />
import type { ResultSummary, ViewUpdate, WorkerRequest, WorkerResponse } from './analysisClient';
import { CampModel, type OverlayPixels } from './model';
import { runAnalysis } from './pipeline';
import { protectionAt } from './summary';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerResponse) => self.postMessage(msg);

/** The latest finished analysis; views and hover readouts are answered from it. */
let model: CampModel | null = null;

async function toPng(p: OverlayPixels): Promise<Blob> {
  const canvas = new OffscreenCanvas(p.width, p.height);
  canvas.getContext('2d')!.putImageData(new ImageData(p.rgba, p.width, p.height), 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

type ViewRequest = Extract<WorkerRequest, { type: 'view' }>;
let pendingView: ViewRequest | null = null;

/**
 * Slider moves can arrive faster than a rescore finishes on a phone: only the latest waiting
 * request is computed, the ones it replaced are answered with null.
 */
function queueView(msg: ViewRequest): void {
  if (pendingView) post({ type: 'view', id: pendingView.id, view: null });
  else setTimeout(() => void runView(), 0);
  pendingView = msg;
}

async function runView(): Promise<void> {
  const msg = pendingView!;
  pendingView = null;
  if (!model) {
    post({ type: 'view', id: msg.id, view: null });
    return;
  }
  try {
    const spots = model.rescore(msg.settings);
    const pixels = model.paint(msg.layer, msg.palette);
    const view: ViewUpdate = {
      spots,
      overlay: pixels ? { blob: await toPng(pixels), bounds: pixels.bounds } : null,
    };
    post({ type: 'view', id: msg.id, view });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: err instanceof Error ? err.message : String(err) });
  }
}

async function analyse(msg: Extract<WorkerRequest, { type: 'analyse' }>): Promise<void> {
  const { id, params } = msg;
  try {
    const result = await runAnalysis(params, (p) => post({ type: 'progress', id, ...p }));
    model = new CampModel(result);
    const summary: ResultSummary = {
      geometry: result.geometry,
      areas: result.areas,
      drinking: result.drinking,
      warnings: result.warnings,
      areaAtCenter: protectionAt(result, params.e, params.n),
      millis: result.millis,
    };
    post({ type: 'result', id, summary });
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'analyse') void analyse(msg);
  else if (msg.type === 'view') queueView(msg);
  else post({ type: 'describe', id: msg.id, text: model?.describeAt(msg.lat, msg.lon) ?? null });
};
