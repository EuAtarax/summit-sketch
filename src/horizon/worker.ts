/// <reference lib="webworker" />
import { lonLatToTile } from '../geo/tiles';
import { elevationAt, snapToSummit } from '../terrain/snap';
import { TerrariumSource } from '../terrain/terrariumSource';
import { linkRidges } from './link';
import { CancelledError, castSector } from './pipeline';
import type { ElevationQuery, FromWorker, ToWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

// Each worker keeps its own tile cache across computations (~40 MB at 160 tiles).
const source = new TerrariumSource({ cacheTiles: 160 });
const running = new Set<number>();
const cancelled = new Set<number>();

/** DEMs blunt summits, so look for the highest cell this close to the point. */
const PEAK_SNAP_RADIUS_M = 100;
const ELEVATION_CONCURRENCY = 8;

/**
 * Summit elevations for many points. Points are visited in tile order so consecutive
 * lookups reuse the same cached tiles instead of thrashing the small tile cache.
 */
async function summitElevations(points: ElevationQuery[]): Promise<Float32Array> {
  const tileKey = (p: ElevationQuery) => {
    const t = lonLatToTile(p.lat, p.lon, p.zoom);
    return [p.zoom, Math.floor(t.y / 2), Math.floor(t.x / 2)];
  };
  const order = points
    .map((p, i) => ({ i, key: tileKey(p) }))
    .sort((a, b) => a.key[0]! - b.key[0]! || a.key[1]! - b.key[1]! || a.key[2]! - b.key[2]!);
  const out = new Float32Array(points.length).fill(Number.NaN);
  let next = 0;
  const lane = async () => {
    while (next < order.length) {
      const { i } = order[next++]!;
      const p = points[i]!;
      out[i] = (await snapToSummit(source, p.lat, p.lon, PEAK_SNAP_RADIUS_M, p.zoom)).elev;
    }
  };
  await Promise.all(Array.from({ length: ELEVATION_CONCURRENCY }, lane));
  return out;
}

function post(msg: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(msg, transfer);
}

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type === 'cancel') {
    if (running.has(msg.job)) cancelled.add(msg.job);
    return;
  }
  const { job } = msg;
  running.add(job);
  try {
    if (msg.type === 'cast') {
      let lastPost = 0;
      const result = await castSector(
        source,
        msg.observer,
        msg.options,
        msg.rayStart,
        msg.rayCount,
        {
          concurrency: 4,
          isCancelled: () => cancelled.has(job),
          onTile: (loaded, total) => {
            const now = performance.now();
            if (loaded === 0 || loaded === total || now - lastPost > 50) {
              lastPost = now;
              post({ type: 'tiles', job, loaded, total });
            }
          },
          onRays: (done) => post({ type: 'rays', job, done }),
        },
      );
      post({ type: 'cast-done', job, result }, [
        result.horizonAngle.buffer,
        result.horizonDist.buffer,
        result.crestOffsets.buffer,
        result.crestAngle.buffer,
        result.crestDist.buffer,
        result.crestElev.buffer,
        result.seaOffsets.buffer,
        result.seaLo.buffer,
        result.seaHi.buffer,
        result.seaLoDist.buffer,
        result.seaHiDist.buffer,
      ]);
    } else if (msg.type === 'snap') {
      const result =
        msg.radiusM > 0
          ? await snapToSummit(source, msg.lat, msg.lon, msg.radiusM)
          : await elevationAt(source, msg.lat, msg.lon);
      post({ type: 'snap-done', job, result });
    } else if (msg.type === 'elevations') {
      const elevations = await summitElevations(msg.points);
      post({ type: 'elevations-done', job, elevations }, [elevations.buffer]);
    } else {
      const ridges = linkRidges(msg.table, msg.options);
      post({ type: 'link-done', job, ridges }, [
        ridges.offsets.buffer,
        ridges.az.buffer,
        ridges.angle.buffer,
        ridges.dist.buffer,
        ridges.elev.buffer,
      ]);
    }
  } catch (err) {
    post({
      type: 'error',
      job,
      message: err instanceof Error ? err.message : String(err),
      cancelled: err instanceof CancelledError,
    });
  } finally {
    running.delete(job);
    cancelled.delete(job);
  }
};
