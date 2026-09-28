import type { PanoramaScene } from '../horizon/scene';
import { seedFor, type PanoramaStyle } from '../render/style';
import { TileCache } from '../render/tileCache';
import { levelFor, sceneAngleRange, visibleTiles, type Level } from '../render/tiles';
import { gridStep, wrap180, wrap360 } from '../render/viewTransform';

export interface PanoramaCanvas {
  /** Points the view at an azimuth (and optionally angle and horizontal field of view). */
  lookAt(az: number, angle?: number, fovDeg?: number): void;
  destroy(): void;
}

const DEFAULT_FOV_DEG = 60;
const MAX_FOV_DEG = 180;
const MAX_PX_PER_DEG = 80;
const COMPASS_PX = 28;
const MAX_DPR = 3;
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
const UI_FONT = '"Atkinson Hyperlegible", system-ui, sans-serif';

/**
 * Endless 360° viewer: drag or swipe (with momentum) to look around and up/down, pinch,
 * wheel or +/− to zoom. Tiles are rendered lazily and reused.
 */
export function mountPanoramaCanvas(
  host: HTMLElement,
  scene: PanoramaScene,
  style: PanoramaStyle,
): PanoramaCanvas {
  const canvas = document.createElement('canvas');
  canvas.className = 'pano-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute(
    'aria-label',
    'Panorama. Drag to look around, pinch or use plus and minus to zoom, arrow keys to pan.',
  );
  const zoomIn = zoomButton('+', 'Zoom in');
  const zoomOut = zoomButton('−', 'Zoom out');
  const controls = document.createElement('div');
  controls.className = 'pano-zoom';
  controls.append(zoomIn, zoomOut);
  host.append(canvas, controls);

  const ctx = canvas.getContext('2d')!;
  const content = sceneAngleRange(scene);
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const cache = new TileCache(
    scene,
    style,
    { seed: seedFor(scene.observer.lat, scene.observer.lon) },
    content,
    dpr,
  );

  let w = 0; // CSS px
  let h = 0;
  let az = 0; // view center
  let angle = 0;
  let ppd = 0; // CSS px per degree
  let initialized = false;
  let frame = 0;
  let lastComplete: Level | null = null;

  // --- view state ---------------------------------------------------------------

  const minPpd = () => w / MAX_FOV_DEG;

  function clampView() {
    ppd = Math.min(MAX_PX_PER_DEG, Math.max(minPpd(), ppd));
    az = wrap360(az);
    const halfH = (h - COMPASS_PX) / 2 / ppd;
    const span = content.top - content.bottom;
    // Center of the area below the compass strip.
    if (span <= 2 * halfH) angle = (content.top + content.bottom) / 2;
    else angle = Math.min(content.top - halfH, Math.max(content.bottom + halfH, angle));
  }

  function initView() {
    ppd = Math.min(40, Math.max(3, w / DEFAULT_FOV_DEG));
    az = 0;
    // Frame the horizon: sky just above the highest horizon point in view.
    let maxH = -90;
    const n = scene.horizonAngle.length;
    const half = w / 2 / ppd;
    for (let d = -half; d <= half; d += scene.azStep) {
      const a = scene.horizonAngle[Math.round(wrap360(az + d) / scene.azStep) % n]!;
      if (a > maxH) maxH = a;
    }
    const halfH = (h - COMPASS_PX) / 2 / ppd;
    angle = Math.min(content.top, maxH + 3) - halfH;
    clampView();
  }

  function zoomAt(px: number, py: number, factor: number) {
    const cy = COMPASS_PX + (h - COMPASS_PX) / 2;
    const azAt = az + (px - w / 2) / ppd;
    const angleAt = angle - (py - cy) / ppd;
    ppd = Math.min(MAX_PX_PER_DEG, Math.max(minPpd(), ppd * factor));
    az = azAt - (px - w / 2) / ppd;
    angle = angleAt + (py - cy) / ppd;
    clampView();
    requestDraw();
  }

  function pan(dx: number, dy: number) {
    az -= dx / ppd;
    angle += dy / ppd;
    clampView();
    requestDraw();
  }

  // --- drawing ------------------------------------------------------------------

  function requestDraw() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function drawLevel(
    level: Level,
    view: Parameters<typeof visibleTiles>[1],
    request: boolean,
  ): boolean {
    let complete = true;
    for (const t of visibleTiles(level, view, content)) {
      const tile = cache.get(t);
      if (tile) {
        const x0 = Math.floor(t.x);
        const y0 = Math.floor(t.y);
        ctx.drawImage(tile, x0, y0, Math.ceil(t.x + t.size) - x0, Math.ceil(t.y + t.size) - y0);
      } else {
        complete = false;
        if (request) cache.want(t);
      }
    }
    return complete;
  }

  function draw() {
    frame = 0;
    if (!w || !h) return;
    const plotTop = COMPASS_PX;
    const plotH = h - COMPASS_PX;
    const angleTop = angle + plotH / 2 / ppd;
    const view = {
      azLeft: az - w / 2 / ppd,
      angleTop: angleTop + plotTop / ppd, // angle at canvas y = 0
      ppd: ppd * dpr,
      width: w * dpr,
      height: h * dpr,
    };
    const level = levelFor(ppd * dpr);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = style.paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    cache.beginFrame();
    // Show the last fully drawn level underneath while the new one renders.
    if (lastComplete && lastComplete !== level) drawLevel(lastComplete, view, false);
    if (drawLevel(level, view, true)) lastComplete = level;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawAngleLabels(angleTop, plotTop);
    drawCompass();

    if (cache.pending) {
      requestAnimationFrame(() => {
        cache.renderPending(8);
        requestDraw();
      });
    }
  }

  function drawCompass() {
    ctx.fillStyle = 'rgba(244,246,247,0.92)';
    ctx.fillRect(0, 0, w, COMPASS_PX);
    ctx.fillStyle = 'rgba(138,145,153,0.5)';
    ctx.fillRect(0, COMPASS_PX - 1, w, 1);
    const azLeft = az - w / 2 / ppd;
    const minor = gridStep(ppd, 10);
    const major = gridStep(ppd, 56);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let a = Math.floor(azLeft / minor) * minor; a <= azLeft + w / ppd; a += minor) {
      const x = Math.round((a - azLeft) * ppd) + 0.5;
      const wa = wrap360(Math.round(a * 1000) / 1000);
      const isMajor = Math.abs(wrap180(a) % major) < 1e-6;
      ctx.strokeStyle = '#8A9199';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, COMPASS_PX - (isMajor ? 8 : 4));
      ctx.lineTo(x, COMPASS_PX - 1);
      ctx.stroke();
      const cardinal = CARDINALS[wa];
      if (cardinal && (isMajor || ppd * 45 >= 40)) {
        ctx.fillStyle = '#1F2A33';
        ctx.font = `bold 13px ${UI_FONT}`;
        ctx.fillText(cardinal, x, 11);
      } else if (isMajor) {
        ctx.fillStyle = '#56606A';
        ctx.font = `11px ${UI_FONT}`;
        ctx.fillText(`${Number(wa.toFixed(1))}°`, x, 11);
      }
    }
    // Heading marker at the center.
    ctx.fillStyle = '#C8102E';
    ctx.beginPath();
    ctx.moveTo(w / 2 - 5, COMPASS_PX);
    ctx.lineTo(w / 2 + 5, COMPASS_PX);
    ctx.lineTo(w / 2, COMPASS_PX - 6);
    ctx.fill();
  }

  function drawAngleLabels(angleTop: number, plotTop: number) {
    const step = gridStep(ppd, 28);
    ctx.font = `11px ${UI_FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'bottom';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(244,246,247,0.9)';
    ctx.fillStyle = '#56606A';
    // Only label angles where there is content.
    const bottom = Math.max(content.bottom, angleTop - (h - plotTop) / ppd);
    const top = Math.min(content.top, angleTop);
    for (let a = Math.ceil(bottom / step) * step; a <= top; a += step) {
      const y = plotTop + (angleTop - a) * ppd - 2;
      if (y < plotTop + 12) continue;
      const label = `${a > 0 ? '+' : a < 0 ? '−' : ''}${Number(Math.abs(a).toFixed(1))}°`;
      ctx.strokeText(label, 4, y);
      ctx.fillText(label, 4, y);
    }
  }

  // --- input ----------------------------------------------------------------------

  const pointers = new Map<number, { x: number; y: number }>();
  let samples: { t: number; x: number; y: number }[] = [];
  let inertia = 0;

  function stopInertia() {
    if (inertia) cancelAnimationFrame(inertia);
    inertia = 0;
  }

  function localPoint(e: PointerEvent | WheelEvent) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function pinchState() {
    const [a, b] = [...pointers.values()];
    return {
      mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 },
      dist: Math.hypot(a!.x - b!.x, a!.y - b!.y),
    };
  }

  const onPointerDown = (e: PointerEvent) => {
    canvas.setPointerCapture(e.pointerId);
    stopInertia();
    pointers.set(e.pointerId, localPoint(e));
    samples = [];
  };

  const onPointerMove = (e: PointerEvent) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const p = localPoint(e);
    if (pointers.size === 1) {
      pan(p.x - prev.x, p.y - prev.y);
      pointers.set(e.pointerId, p);
      samples.push({ t: e.timeStamp, x: p.x, y: p.y });
      if (samples.length > 8) samples.shift();
    } else if (pointers.size === 2) {
      const before = pinchState();
      pointers.set(e.pointerId, p);
      const after = pinchState();
      if (before.dist > 0) zoomAt(after.mid.x, after.mid.y, after.dist / before.dist);
      pan(after.mid.x - before.mid.x, after.mid.y - before.mid.y);
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size > 0 || reducedMotion) {
      samples = [];
      return;
    }
    const recent = samples.filter((s) => e.timeStamp - s.t < 100);
    const first = recent[0];
    const last = recent[recent.length - 1];
    samples = [];
    if (!first || !last || last.t - first.t < 8) return;
    let vx = (last.x - first.x) / (last.t - first.t); // px per ms
    let vy = (last.y - first.y) / (last.t - first.t);
    if (Math.hypot(vx, vy) < 0.15) return;
    let t0 = performance.now();
    const step = (now: number) => {
      const dt = Math.min(48, now - t0);
      t0 = now;
      pan(vx * dt, vy * dt);
      const decay = Math.pow(0.995, dt);
      vx *= decay;
      vy *= decay;
      inertia = Math.hypot(vx, vy) > 0.02 ? requestAnimationFrame(step) : 0;
    };
    inertia = requestAnimationFrame(step);
  };

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    stopInertia();
    const p = localPoint(e);
    const scale = e.deltaMode === 1 ? 16 : 1; // lines → px
    if (e.ctrlKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      zoomAt(p.x, p.y, Math.exp(-e.deltaY * scale * 0.002));
    } else {
      pan(-e.deltaX * scale, 0);
    }
  };

  const onKey = (e: KeyboardEvent) => {
    const keys: Record<string, () => void> = {
      ArrowLeft: () => pan(w / 8, 0),
      ArrowRight: () => pan(-w / 8, 0),
      ArrowUp: () => pan(0, 2 * ppd),
      ArrowDown: () => pan(0, -2 * ppd),
      '+': () => zoomAt(w / 2, h / 2, 1.25),
      '=': () => zoomAt(w / 2, h / 2, 1.25),
      '-': () => zoomAt(w / 2, h / 2, 0.8),
    };
    const action = keys[e.key];
    if (action) {
      e.preventDefault();
      action();
    }
  };

  zoomIn.onclick = () => zoomAt(w / 2, h / 2, 1.4);
  zoomOut.onclick = () => zoomAt(w / 2, h / 2, 1 / 1.4);
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);

  const resize = new ResizeObserver(() => {
    const r = host.getBoundingClientRect();
    if (!r.width || !r.height) return;
    w = r.width;
    h = r.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    if (!initialized) {
      initialized = true;
      initView();
    } else {
      clampView();
    }
    requestDraw();
  });
  resize.observe(host);

  return {
    lookAt(toAz, toAngle, fovDeg) {
      stopInertia();
      az = toAz;
      if (fovDeg) ppd = w / fovDeg;
      if (toAngle !== undefined) angle = toAngle;
      clampView();
      requestDraw();
    },
    destroy() {
      stopInertia();
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      canvas.remove();
      controls.remove();
    },
  };
}

function zoomButton(text: string, label: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'icon-button pano-zoom-button';
  b.textContent = text;
  b.setAttribute('aria-label', label);
  return b;
}
