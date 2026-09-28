/**
 * Phase 1 data spike: prove the browser can fetch Terrarium tiles over CORS
 * and decode a correct elevation for the Zugspitze summit (≈ 2962 m).
 */
import './styles.css';
import { lonLatToTile, metersPerPixel, TILE_SIZE } from './geo/tiles';
import { fetchTerrariumTile, type DecodedTile } from './terrain/fetchTerrarium';
import { sampleBilinear } from './terrain/terrarium';

const TARGET = { name: 'Zugspitze', lat: 47.4211, lon: 10.9853, expected: 2962 };
const SNAP_RADIUS_M = 150;
const TOLERANCE_M = 30;

interface Result {
  status: 'pass' | 'fail' | 'error';
  lines: string[];
}

async function runAtZoom(z: number): Promise<{ point: number; max: number; lines: string[] }> {
  const t = lonLatToTile(TARGET.lat, TARGET.lon, z);
  const gx = t.x * TILE_SIZE; // global pixel coords
  const gy = t.y * TILE_SIZE;
  const rPx = SNAP_RADIUS_M / metersPerPixel(TARGET.lat, z);

  // All tiles touched by the snap window (usually 1, at most 4).
  const tiles = new Map<string, DecodedTile>();
  const tx0 = Math.floor((gx - rPx) / TILE_SIZE);
  const tx1 = Math.floor((gx + rPx) / TILE_SIZE);
  const ty0 = Math.floor((gy - rPx) / TILE_SIZE);
  const ty1 = Math.floor((gy + rPx) / TILE_SIZE);
  const started = performance.now();
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      jobs.push(fetchTerrariumTile(z, tx, ty).then((tile) => void tiles.set(`${tx}/${ty}`, tile)));
    }
  }
  await Promise.all(jobs);
  const ms = performance.now() - started;

  const center = tiles.get(`${Math.floor(t.x)}/${Math.floor(t.y)}`)!;
  const point = sampleBilinear(
    center.elev,
    TILE_SIZE,
    gx - center.x * TILE_SIZE,
    gy - center.y * TILE_SIZE,
  );

  let max = -Infinity;
  for (let py = Math.floor(gy - rPx); py <= Math.ceil(gy + rPx); py++) {
    for (let px = Math.floor(gx - rPx); px <= Math.ceil(gx + rPx); px++) {
      if ((px + 0.5 - gx) ** 2 + (py + 0.5 - gy) ** 2 > rPx * rPx) continue;
      const tile = tiles.get(`${Math.floor(px / TILE_SIZE)}/${Math.floor(py / TILE_SIZE)}`)!;
      const v = tile.elev[(py - tile.y * TILE_SIZE) * TILE_SIZE + (px - tile.x * TILE_SIZE)]!;
      if (v > max) max = v;
    }
  }

  const ids = [...tiles.values()].map((d) => `${d.z}/${d.x}/${d.y}`).join(', ');
  return {
    point,
    max,
    lines: [
      `z${z}: fetched ${tiles.size} tile(s) [${ids}] in ${ms.toFixed(0)} ms, ` +
        `${metersPerPixel(TARGET.lat, z).toFixed(1)} m/px`,
      `  bilinear at point: ${point.toFixed(1)} m · max within ${SNAP_RADIUS_M} m: ${max.toFixed(1)} m`,
      `  imagery sources: ${center.imagerySources ?? '(header not exposed)'}`,
    ],
  };
}

async function run(): Promise<Result> {
  const lines = [
    `Origin: ${location.origin}`,
    `Target: ${TARGET.name} (${TARGET.lat}, ${TARGET.lon}), expected ≈ ${TARGET.expected} m`,
    '',
  ];
  try {
    const z15 = await runAtZoom(15);
    const z12 = await runAtZoom(12);
    lines.push(...z15.lines, ...z12.lines, '');
    const err = z15.max - TARGET.expected;
    const pass = Math.abs(err) <= TOLERANCE_M;
    lines.push(
      `Result: z15 snapped elevation ${z15.max.toFixed(1)} m, off by ${err.toFixed(1)} m ` +
        `(tolerance ±${TOLERANCE_M} m) → ${pass ? 'PASS' : 'FAIL'}`,
    );
    return { status: pass ? 'pass' : 'fail', lines };
  } catch (e) {
    lines.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
    lines.push('A TypeError "Failed to fetch" here usually means CORS or network blocking.');
    return { status: 'error', lines };
  }
}

const root = document.getElementById('app')!;
root.innerHTML = '<main class="app-main"><pre id="out">Running…</pre></main>';
void run().then(({ status, lines }) => {
  const out = document.getElementById('out')!;
  out.textContent = lines.join('\n');
  document.body.dataset.status = status;
  console.log(`[spike] ${status}\n${lines.join('\n')}`);
});
