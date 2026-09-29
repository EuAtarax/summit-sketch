import type { EngineStats } from '../horizon/engine';
import type { PanoramaScene } from '../horizon/scene';
import type { LabelCandidate } from '../render/labelLayout';
import { loadLabelFonts } from '../render/labels';
import type { PanoramaStyle } from '../render/style';
import { createAttributionFooter } from './attribution';
import { formatCoords, formatSeconds } from './format';
import { mountPanoramaCanvas, type PanoramaCanvas } from './panoramaCanvas';
import { createStyleBar, renderOptionsFor, type StyleBar, type StyleChoice } from './stylePicker';

const LABELS_ERROR = "Couldn't load peak names. Check your connection and try again.";
const NO_LABELS = 'No named peaks are visible from here.';

export interface PanoramaView {
  open(title: string, subtitle: string): void;
  progress(text: string, fraction: number | null): void;
  showScene(scene: PanoramaScene, stats: EngineStats): void;
  showError(message: string, retry: () => void): void;
  close(): void;
  /** The live viewer, if a scene is shown (for debugging and tests). */
  readonly canvas: PanoramaCanvas | null;
  readonly styleBar: StyleBar;
}

/** Full-bleed viewer screen: title bar, progress, the endless panorama, styles, attribution. */
export function createPanoramaView(
  parent: HTMLElement,
  onBack: () => void,
  styles: readonly PanoramaStyle[],
  initialChoice: StyleChoice,
  onChoice: (c: StyleChoice) => void,
  /** Peaks to label for a scene, most important first. */
  loadLabels: (scene: PanoramaScene) => Promise<LabelCandidate[]>,
): PanoramaView {
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

  const controls = document.createElement('div');
  controls.className = 'viewer-controls';

  const info = document.createElement('p');
  info.className = 'viewer-info';

  stage.append(pano, status);
  root.append(bar, stage, controls, info, createAttributionFooter());
  parent.append(root);

  let viewer: PanoramaCanvas | null = null;
  let scene: PanoramaScene | null = null;
  /** Label candidates of the current scene, once loaded. */
  let candidates: LabelCandidate[] | null = null;
  let labelRun = 0;
  let labelsShown = initialChoice.labels;

  const styleOf = (id: string) => styles.find((s) => s.id === id) ?? styles[0]!;

  const styleBar = createStyleBar(
    controls,
    styles,
    initialChoice,
    (c) => {
      if (viewer && scene)
        viewer.setVariant(styleOf(c.styleId), renderOptionsFor(c, scene), c.exaggeration);
      if (c.labels !== labelsShown) void syncLabels();
      onChoice(c);
    },
    () => viewer?.autoExaggeration ?? 1,
  );

  /** Makes the viewer match the labels toggle, loading peak names on first use. */
  async function syncLabels(): Promise<void> {
    const wanted = styleBar.choice.labels;
    labelsShown = wanted;
    const run = ++labelRun;
    const sc = scene;
    if (!viewer || !sc) return;
    if (!wanted) {
      viewer.setLabels(null);
      styleBar.setLabelState({ kind: 'idle' });
      return;
    }
    if (!candidates) {
      styleBar.setLabelState({ kind: 'loading' });
      try {
        [candidates] = await Promise.all([
          loadLabels(sc),
          loadLabelFonts(styles.map((s) => s.labelStyle)),
        ]);
      } catch (err) {
        console.error(err);
        if (run === labelRun && sc === scene) {
          styleBar.setLabelState({
            kind: 'message',
            text: LABELS_ERROR,
            retry: () => void syncLabels(),
          });
        }
        return;
      }
    }
    // A newer toggle or a different panorama superseded this one.
    if (run !== labelRun || sc !== scene) return;
    viewer?.setLabels(candidates);
    styleBar.setLabelState(
      candidates.length ? { kind: 'idle' } : { kind: 'message', text: NO_LABELS },
    );
  }

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
    styleBar,
    open(t, s) {
      clearViewer();
      candidates = null;
      labelRun++;
      styleBar.setLabelState({ kind: 'idle' });
      title.textContent = t;
      subtitle.textContent = s;
      info.textContent = '';
      controls.hidden = true;
      root.hidden = false;
      setStatus('Starting…', 0);
      back.focus({ preventScroll: true });
    },
    progress: setStatus,
    showScene(sc, stats) {
      clearViewer();
      scene = sc;
      status.hidden = true;
      controls.hidden = false;
      const c = styleBar.choice;
      viewer = mountPanoramaCanvas(
        pano,
        sc,
        { style: styleOf(c.styleId), opts: renderOptionsFor(c, sc), exaggeration: c.exaggeration },
        () => viewer && styleBar.refresh(viewer.heading.az),
      );
      // The viewer sizes itself on the next frame; thumbnails use its heading then.
      requestAnimationFrame(() => viewer && styleBar.setScene(sc, viewer.heading.az));
      candidates = null;
      if (c.labels) void syncLabels();
      const o = sc.observer;
      info.textContent =
        `${formatCoords(o.lat, o.lon)} · eye ${Math.round(o.groundElev + o.eyeHeight)} m · ` +
        `${sc.radiusM / 1000} km · ${stats.tiles} tiles · ${stats.ridgelines} ridgelines · ` +
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
