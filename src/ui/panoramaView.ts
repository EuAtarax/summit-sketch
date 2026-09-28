import type { EngineStats } from '../horizon/engine';
import type { PanoramaScene } from '../horizon/scene';
import { runChunked } from '../render/chunked';
import { debugLayout, renderDebugSteps } from '../render/debugRenderer';
import { createAttributionFooter } from './attribution';
import { formatCoords, formatSeconds } from './format';

export interface PanoramaView {
  open(title: string, subtitle: string): void;
  progress(text: string, fraction: number | null): void;
  showScene(scene: PanoramaScene, stats: EngineStats): Promise<void>;
  showError(message: string, retry: () => void): void;
  close(): void;
}

const MAX_DPR = 2;
/** Full 360° canvas budget; the Phase 4 viewer will render only the visible window. */
const MAX_CANVAS_PIXELS = 4_000_000;

/** Full-bleed viewer. For now it shows the debug renderer in a horizontal scroller. */
export function createPanoramaView(parent: HTMLElement, onBack: () => void): PanoramaView {
  const root = document.createElement('section');
  root.className = 'viewer';
  root.hidden = true;
  root.setAttribute('aria-label', 'Panorama');

  const bar = document.createElement('header');
  bar.className = 'viewer-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'icon-button';
  back.setAttribute('aria-label', 'Back to the map');
  back.textContent = '←';
  back.onclick = onBack;
  const titles = document.createElement('div');
  titles.className = 'viewer-titles';
  const title = document.createElement('h2');
  const subtitle = document.createElement('p');
  titles.append(title, subtitle);
  bar.append(back, titles);

  const stage = document.createElement('div');
  stage.className = 'viewer-stage';

  const status = document.createElement('div');
  status.className = 'viewer-status';
  status.setAttribute('role', 'status');
  const statusText = document.createElement('p');
  const bar2 = document.createElement('div');
  bar2.className = 'progress';
  const fill = document.createElement('div');
  bar2.append(fill);
  status.append(statusText, bar2);

  const scroller = document.createElement('div');
  scroller.className = 'viewer-scroller';
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', 'Panorama, scroll sideways to look around');
  const canvas = document.createElement('canvas');
  scroller.append(canvas);

  const info = document.createElement('p');
  info.className = 'viewer-info';

  stage.append(status, scroller);
  root.append(bar, stage, info, createAttributionFooter());
  parent.append(root);

  let drawToken = 0;

  const setStatus = (text: string, fraction: number | null) => {
    status.hidden = false;
    status.querySelector('button')?.remove();
    statusText.textContent = text;
    bar2.hidden = fraction === null;
    fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  };

  return {
    open(t, s) {
      drawToken++;
      title.textContent = t;
      subtitle.textContent = s;
      scroller.hidden = true;
      info.textContent = '';
      root.hidden = false;
      setStatus('Starting…', 0);
      back.focus({ preventScroll: true });
    },
    progress: setStatus,
    async showScene(scene, stats) {
      const token = ++drawToken;
      setStatus('Drawing', null);
      scroller.hidden = false;
      const available = Math.max(160, scroller.clientHeight - 24);
      const range = debugLayout(scene, 1, 0);
      const pxPerDeg = Math.min(24, Math.max(8, available / (range.angleTop - range.angleBottom)));
      const layout = debugLayout(scene, pxPerDeg);
      const dpr = Math.min(
        window.devicePixelRatio || 1,
        MAX_DPR,
        Math.sqrt(MAX_CANVAS_PIXELS / (layout.width * layout.height)),
      );
      canvas.width = Math.round(layout.width * dpr);
      canvas.height = Math.round(layout.height * dpr);
      canvas.style.width = `${layout.width}px`;
      canvas.style.height = `${layout.height}px`;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setStatus("Your browser can't draw the panorama (no 2D canvas).", null);
        return;
      }
      const t0 = performance.now();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await runChunked(renderDebugSteps(ctx, scene, layout), () => token !== drawToken);
      if (token !== drawToken) return;
      const drawMs = performance.now() - t0;
      status.hidden = true;
      const o = scene.observer;
      info.textContent =
        `${formatCoords(o.lat, o.lon)} · eye ${Math.round(o.groundElev + o.eyeHeight)} m · ` +
        `${scene.radiusM / 1000} km · ${stats.tiles} tiles · ${stats.ridgelines} ridgelines · ` +
        `terrain ${formatSeconds(stats.loadMs)}, total ${formatSeconds(stats.totalMs)}, ` +
        `draw ${Math.round(drawMs)} ms · ${stats.workers} workers`;
    },
    showError(message, retry) {
      setStatus(message, null);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary-button';
      b.textContent = 'Try again';
      b.onclick = retry;
      status.append(b);
    },
    close() {
      drawToken++;
      root.hidden = true;
    },
  };
}
