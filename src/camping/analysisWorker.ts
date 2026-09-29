/// <reference lib="webworker" />
import type { WorkerRequest, WorkerResponse } from './analysisClient';
import { runAnalysis } from './pipeline';

declare const self: DedicatedWorkerGlobalScope;

const post = (msg: WorkerResponse, transfer: Transferable[] = []) =>
  self.postMessage(msg, transfer);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, params } = e.data;
  try {
    const result = await runAnalysis(params, (p) => post({ type: 'progress', id, ...p }));
    const arrays = [result.elevation, result.slope, result.roughness, result.water, result.canopy];
    post(
      { type: 'result', id, result },
      arrays.filter((a): a is Float32Array => a !== undefined).map((a) => a.buffer),
    );
  } catch (err) {
    post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
  }
};
