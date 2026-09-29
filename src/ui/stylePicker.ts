import type { PanoramaScene } from '../horizon/scene';
import { snowlineFor } from '../render/depth';
import { seedFor, type PaletteId, type PanoramaStyle, type RenderOptions } from '../render/style';
import { autoExaggeration } from '../render/tiles';
import { createViewTransform, wrap360 } from '../render/viewTransform';

export interface StyleChoice {
  styleId: string;
  palette: PaletteId;
  /** null = automatic from latitude. */
  snowlineM: number | null;
  exaggeration: number | 'auto';
}

export const DEFAULT_CHOICE: Omit<StyleChoice, 'styleId'> = {
  palette: 'day',
  snowlineM: null,
  exaggeration: 'auto',
};

const STORAGE_KEY = 'summit-sketch:style';
const THUMB_W = 88;
const THUMB_H = 52;
const THUMB_FOV = 60;

export function loadChoice(fallbackStyleId: string): StyleChoice {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { styleId: fallbackStyleId, ...DEFAULT_CHOICE, ...JSON.parse(raw) };
  } catch {
    // Storage unavailable (private mode, blocked): use defaults.
  }
  return { styleId: fallbackStyleId, ...DEFAULT_CHOICE };
}

export function saveChoice(c: StyleChoice): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    // Not critical.
  }
}

export function renderOptionsFor(c: StyleChoice, scene: PanoramaScene): RenderOptions {
  const o = scene.observer;
  return {
    seed: seedFor(o.lat, o.lon),
    snowlineM: c.snowlineM ?? snowlineFor(o.lat),
    palette: c.palette,
  };
}

/** Renders a small live preview of a style around the given heading. */
function renderThumb(
  canvas: HTMLCanvasElement,
  style: PanoramaStyle,
  scene: PanoramaScene,
  opts: RenderOptions,
  az: number,
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  canvas.width = Math.round(THUMB_W * dpr);
  canvas.height = Math.round(THUMB_H * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const ppd = THUMB_W / THUMB_FOV;
  const e = autoExaggeration(scene, ppd, THUMB_H);
  const azStart = wrap360(az - THUMB_FOV / 2);
  const n = scene.horizonAngle.length;
  let maxH = -90;
  for (let d = 0; d <= THUMB_FOV; d += scene.azStep) {
    const a = scene.horizonAngle[Math.round(wrap360(azStart + d) / scene.azStep) % n]!;
    if (a > maxH) maxH = a;
  }
  const view = createViewTransform({
    width: THUMB_W,
    height: THUMB_H,
    azStart,
    pxPerDeg: ppd,
    angleAtTop: maxH + (0.35 * THUMB_H) / (ppd * e),
    exaggeration: e,
  });
  style.render(ctx, scene, view, opts);
}

export interface StyleBar {
  setScene(scene: PanoramaScene, headingAz: number): void;
  /** Re-renders the thumbnails around a new heading (e.g. after panning). */
  refresh(headingAz: number): void;
  readonly choice: StyleChoice;
}

/**
 * Bottom bar with a thumbnail per style (the real scene, live) and an Adjust panel for
 * the palette, snowline and vertical exaggeration.
 */
export function createStyleBar(
  parent: HTMLElement,
  styles: readonly PanoramaStyle[],
  initial: StyleChoice,
  onChange: (c: StyleChoice) => void,
  autoExaggerationOf: () => number,
): StyleBar {
  let choice = styles.some((s) => s.id === initial.styleId)
    ? initial
    : { ...initial, styleId: styles[0]!.id };
  let scene: PanoramaScene | null = null;
  let heading = 0;

  const bar = document.createElement('div');
  bar.className = 'style-bar';
  const list = document.createElement('div');
  list.className = 'style-list';
  list.setAttribute('role', 'radiogroup');
  list.setAttribute('aria-label', 'Style');

  const thumbs = new Map<string, HTMLCanvasElement>();
  const buttons = new Map<string, HTMLButtonElement>();
  for (const s of styles) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'style-option';
    b.setAttribute('role', 'radio');
    const c = document.createElement('canvas');
    c.style.width = `${THUMB_W}px`;
    c.style.height = `${THUMB_H}px`;
    const label = document.createElement('span');
    label.textContent = s.name;
    b.append(c, label);
    b.onclick = () => update({ styleId: s.id });
    thumbs.set(s.id, c);
    buttons.set(s.id, b);
    list.append(b);
  }

  const adjust = document.createElement('button');
  adjust.type = 'button';
  adjust.className = 'adjust-button';
  adjust.textContent = 'Adjust';
  adjust.setAttribute('aria-expanded', 'false');
  const panel = document.createElement('div');
  panel.className = 'adjust-panel';
  panel.hidden = true;
  adjust.onclick = () => {
    panel.hidden = !panel.hidden;
    adjust.setAttribute('aria-expanded', String(!panel.hidden));
    renderPanel();
  };

  bar.append(list, adjust);
  parent.append(panel, bar);

  function styleOf(id: string) {
    return styles.find((s) => s.id === id) ?? styles[0]!;
  }

  function renderThumbs(ids: readonly string[] = [...thumbs.keys()]) {
    if (!scene) return;
    for (const id of ids) {
      const s = styleOf(id);
      renderThumb(thumbs.get(id)!, s, scene, renderOptionsFor(choice, scene), heading);
    }
  }

  function syncButtons() {
    for (const [id, b] of buttons) {
      b.setAttribute('aria-checked', String(id === choice.styleId));
    }
  }

  function update(patch: Partial<StyleChoice>) {
    const before = choice;
    choice = { ...choice, ...patch };
    syncButtons();
    // Thumbnails of styles that use a changed option need a redraw.
    const changed = styles
      .filter(
        (s) =>
          (patch.palette !== undefined &&
            patch.palette !== before.palette &&
            s.uses.includes('palette')) ||
          (patch.snowlineM !== undefined &&
            patch.snowlineM !== before.snowlineM &&
            s.uses.includes('snowline')),
      )
      .map((s) => s.id);
    if (changed.length) renderThumbs(changed);
    renderPanel();
    onChange(choice);
  }

  function row(labelText: string, control: HTMLElement): HTMLElement {
    const r = document.createElement('label');
    r.className = 'adjust-row';
    const t = document.createElement('span');
    t.textContent = labelText;
    r.append(t, control);
    return r;
  }

  function renderPanel() {
    if (panel.hidden) return;
    const s = styleOf(choice.styleId);
    const rows: HTMLElement[] = [];

    if (s.uses.includes('palette')) {
      const seg = document.createElement('div');
      seg.className = 'segmented palette';
      seg.setAttribute('role', 'radiogroup');
      seg.setAttribute('aria-label', 'Palette');
      for (const [id, name] of [
        ['dawn', 'Dawn'],
        ['day', 'Day'],
        ['dusk', 'Dusk'],
      ] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', String(choice.palette === id));
        b.onclick = () => update({ palette: id });
        seg.append(b);
      }
      const wrap = document.createElement('div');
      wrap.className = 'adjust-row';
      const t = document.createElement('span');
      t.textContent = 'Palette';
      wrap.append(t, seg);
      rows.push(wrap);
    }

    if (s.uses.includes('snowline') && scene) {
      const auto = snowlineFor(scene.observer.lat);
      const value = choice.snowlineM ?? auto;
      const input = document.createElement('input');
      input.type = 'range';
      input.min = '500';
      input.max = '6000';
      input.step = '50';
      input.value = String(Math.round(value));
      const out = document.createElement('output');
      out.textContent = `${Math.round(value)} m${choice.snowlineM === null ? ' (auto)' : ''}`;
      input.oninput = () => (out.textContent = `${input.value} m`);
      input.onchange = () => update({ snowlineM: Number(input.value) });
      const box = document.createElement('div');
      box.className = 'range';
      box.append(input, out);
      rows.push(row('Snowline', box));
    }

    const eValue = choice.exaggeration === 'auto' ? autoExaggerationOf() : choice.exaggeration;
    const eInput = document.createElement('input');
    eInput.type = 'range';
    eInput.min = '1';
    eInput.max = '3';
    eInput.step = '0.25';
    eInput.value = String(eValue);
    const eOut = document.createElement('output');
    const fmt = (x: number) => `${Number(x.toFixed(2))}×`;
    eOut.textContent = `${fmt(eValue)}${choice.exaggeration === 'auto' ? ' (auto)' : ''}`;
    eInput.oninput = () => (eOut.textContent = fmt(Number(eInput.value)));
    eInput.onchange = () => update({ exaggeration: Number(eInput.value) });
    const eBox = document.createElement('div');
    eBox.className = 'range';
    eBox.append(eInput, eOut);
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'text-button';
    reset.textContent = 'Auto';
    reset.disabled = choice.exaggeration === 'auto';
    reset.onclick = () => update({ exaggeration: 'auto' });
    eBox.append(reset);
    rows.push(row('Height scale', eBox));

    panel.replaceChildren(...rows);
  }

  syncButtons();
  return {
    get choice() {
      return choice;
    },
    setScene(s, az) {
      scene = s;
      heading = az;
      renderThumbs();
      renderPanel();
    },
    refresh(az) {
      heading = az;
      renderThumbs();
    },
  };
}
