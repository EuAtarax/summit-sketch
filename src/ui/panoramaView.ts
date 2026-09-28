import type { EngineStats } from '../horizon/engine';
import type { PanoramaScene } from '../horizon/scene';
import { debugStyle } from '../render/styles/debugStyle';
import { createAttributionFooter } from './attribution';
import { formatCoords, formatSeconds } from './format';
import { mountPanoramaCanvas, type PanoramaCanvas } from './panoramaCanvas';

export interface PanoramaView {
  open(title: string, subtitle: string): void;
  progress(text: string, fraction: number | null): void;
  showScene(scene: PanoramaScene, stats: EngineStats): void;
  showError(message: string, retry: () => void): void;
  close(): void;
  /** The live viewer, if a scene is shown (for debugging and tests). */
  readonly canvas: PanoramaCanvas | null;
}

/** Full-bleed viewer screen: title bar, progress, the endless panorama and attribution. */
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

  const pano = document.createElement('div');
  pano.className = 'viewer-pano';

  const info = document.createElement('p');
  info.className = 'viewer-info';

  stage.append(pano, status);
  root.append(bar, stage, info, createAttributionFooter());
  parent.append(root);

  let viewer: PanoramaCanvas | null = null;

  const setStatus = (text: string, fraction: number | null) => {
    status.hidden = false;
    status.querySelector('button')?.remove();
    statusText.textContent = text;
    bar2.hidden = fraction === null;
    fill.style.width = `${Math.round((fraction ?? 0) * 100)}%`;
  };

  const clearViewer = () => {
    viewer?.destroy();
    viewer = null;
  };

  return {
    get canvas() {
      return viewer;
    },
    open(t, s) {
      clearViewer();
      title.textContent = t;
      subtitle.textContent = s;
      info.textContent = '';
      root.hidden = false;
      setStatus('Starting…', 0);
      back.focus({ preventScroll: true });
    },
    progress: setStatus,
    showScene(scene, stats) {
      clearViewer();
      status.hidden = true;
      viewer = mountPanoramaCanvas(pano, scene, debugStyle);
      const o = scene.observer;
      info.textContent =
        `${formatCoords(o.lat, o.lon)} · eye ${Math.round(o.groundElev + o.eyeHeight)} m · ` +
        `${scene.radiusM / 1000} km · ${stats.tiles} tiles · ${stats.ridgelines} ridgelines · ` +
        `terrain ${formatSeconds(stats.loadMs)}, total ${formatSeconds(stats.totalMs)} · ` +
        `${stats.workers} workers`;
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
      clearViewer();
      root.hidden = true;
    },
  };
}
