import type { PanoramaScene } from '../horizon/scene';

export interface DebugLayout {
  pxPerDeg: number;
  /** Elevation angle at the top of the plot area, degrees. */
  angleTop: number;
  angleBottom: number;
  /** Space above the plot for compass labels, CSS px. */
  headerPx: number;
  width: number;
  height: number;
}

const COLORS = {
  paper: '#F4F6F7',
  ink: '#1F2A33',
  stone: '#8A9199',
  near: [31, 42, 51] as const, // slate ink
  far: [168, 196, 207] as const, // pale glacier
  horizon: '#C8102E',
};

const CARDINALS: Record<number, string> = {
  0: 'N',
  45: 'NE',
  90: 'E',
  135: 'SE',
  180: 'S',
  225: 'SW',
  270: 'W',
  315: 'NW',
};

/** Vertical range: a bit above the highest horizon, down to the lowest ridge (max 20° span). */
export function debugAngleRange(scene: PanoramaScene): { top: number; bottom: number } {
  let maxH = -90;
  let minH = 90;
  for (const a of scene.horizonAngle) {
    if (Number.isNaN(a)) continue;
    if (a > maxH) maxH = a;
    if (a < minH) minH = a;
  }
  let minRidge = minH;
  for (const l of scene.ridgelines)
    for (const p of l.points) if (p.angle < minRidge) minRidge = p.angle;
  const top = Math.ceil(maxH + 1);
  const bottom = Math.floor(Math.max(minRidge - 0.5, top - 20, minH - 8));
  return { top, bottom: Math.min(bottom, top - 3) };
}

export function debugLayout(scene: PanoramaScene, pxPerDeg: number, headerPx = 28): DebugLayout {
  const { top, bottom } = debugAngleRange(scene);
  return {
    pxPerDeg,
    angleTop: top,
    angleBottom: bottom,
    headerPx,
    width: Math.round(360 * pxPerDeg),
    height: Math.round(headerPx + (top - bottom) * pxPerDeg),
  };
}

/** Distance → color on a log scale from 1 km (near, dark) to the radius (far, pale). */
function distColor(dist: number, radiusM: number): string {
  const t = Math.min(1, Math.max(0, Math.log(dist / 1000) / Math.log(radiusM / 1000)));
  const c = COLORS.near.map((n, i) => Math.round(n + (COLORS.far[i]! - n) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

/**
 * Debug view: every ridgeline as a plain line colored by distance, the outer horizon in
 * red, and a degree grid. Azimuth 0 (north) is at x = 0.
 */
export function renderDebug(
  ctx: CanvasRenderingContext2D,
  scene: PanoramaScene,
  L: DebugLayout,
): void {
  const steps = renderDebugSteps(ctx, scene, L);
  while (!steps.next().done) {
    // run to completion
  }
}

/** Same as renderDebug, but yields between batches so callers can spread it over frames. */
export function* renderDebugSteps(
  ctx: CanvasRenderingContext2D,
  scene: PanoramaScene,
  L: DebugLayout,
): Generator<void, void, void> {
  const x = (az: number) => az * L.pxPerDeg;
  const y = (angle: number) => L.headerPx + (L.angleTop - angle) * L.pxPerDeg;

  ctx.fillStyle = COLORS.paper;
  ctx.fillRect(0, 0, L.width, L.height);

  // Grid
  ctx.lineWidth = 1;
  ctx.font = '12px "Atkinson Hyperlegible", system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  for (let a = Math.ceil(L.angleBottom); a <= L.angleTop; a++) {
    ctx.strokeStyle = a === 0 ? 'rgba(31,42,51,0.45)' : 'rgba(138,145,153,0.25)';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(y(a)) + 0.5);
    ctx.lineTo(L.width, Math.round(y(a)) + 0.5);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  for (let az = 0; az < 360; az += 5) {
    const major = az % 10 === 0;
    ctx.strokeStyle = CARDINALS[az] ? 'rgba(31,42,51,0.4)' : 'rgba(138,145,153,0.25)';
    ctx.beginPath();
    ctx.moveTo(Math.round(x(az)) + 0.5, major ? L.headerPx - 6 : L.headerPx - 3);
    ctx.lineTo(Math.round(x(az)) + 0.5, L.height);
    ctx.stroke();
    if (CARDINALS[az]) {
      ctx.fillStyle = COLORS.ink;
      ctx.font = 'bold 13px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.fillText(CARDINALS[az]!, x(az) + (az === 0 ? 8 : 0), 11);
    } else if (major) {
      ctx.fillStyle = COLORS.stone;
      ctx.font = '11px "Atkinson Hyperlegible", system-ui, sans-serif';
      ctx.fillText(`${az}°`, x(az), 11);
    }
  }
  ctx.textAlign = 'left';
  ctx.fillStyle = COLORS.stone;
  ctx.font = '11px "Atkinson Hyperlegible", system-ui, sans-serif';
  for (let a = Math.ceil(L.angleBottom) + 1; a <= L.angleTop; a++) {
    for (const az of [0, 90, 180, 270]) {
      ctx.fillText(`${a > 0 ? '+' : ''}${a}°`, x(az) + 3, y(a) - 7);
    }
  }

  yield;

  // Ridgelines, far first so near ones end up on top.
  const maxGap = scene.azStep * 1.5;
  const ridges = [...scene.ridgelines].sort((a, b) => b.minDist - a.minDist);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  let batch = 0;
  for (const r of ridges) {
    if (++batch % 64 === 0) yield;
    const mid = (r.minDist + r.maxDist) / 2;
    ctx.strokeStyle = distColor(mid, scene.radiusM);
    ctx.lineWidth = mid < 10_000 ? 1.6 : mid < 50_000 ? 1.2 : 1;
    ctx.beginPath();
    let prevAz = NaN;
    for (const p of r.points) {
      if (Number.isNaN(prevAz) || Math.abs(p.az - prevAz) > maxGap) ctx.moveTo(x(p.az), y(p.angle));
      else ctx.lineTo(x(p.az), y(p.angle));
      prevAz = p.az;
    }
    ctx.stroke();
  }

  // Outer horizon
  ctx.strokeStyle = COLORS.horizon;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  let pen = false;
  scene.horizonAngle.forEach((a, i) => {
    if (Number.isNaN(a)) {
      pen = false;
      return;
    }
    const px = x(i * scene.azStep);
    if (pen) ctx.lineTo(px, y(a));
    else ctx.moveTo(px, y(a));
    pen = true;
  });
  ctx.stroke();
}
