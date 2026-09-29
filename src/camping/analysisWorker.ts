/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './analysisClient';
import { runAnalysis, type AnalysisResult } from './pipeline';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

/** The big arrays are moved to the page instead of being copied. */
function transferables(r: AnalysisResult): Transferable[] {
  const arrays = [
    r.slope,
    r.roughness,
    r.water,
    r.canopy,
    r.trailDistance,
    r.waterDistance,
    r.drinkingDistance,
    r.protectionIndex,
  ];
  return arrays.filter((a) => a !== undefined).map((a) => a.buffer);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const result = await runAnalysis(params, (p) => post({ type: 'progress', id, ...p }));
    post({ type: 'result', id, result }, transferables(result));
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
