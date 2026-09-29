import type { SuitabilityParams } from './analysis';
import { LAYERS, type LayerId } from './heatmap';
import { OVERLAYS } from './overlays';
import { PALETTES, paletteGradientCss, type PaletteId } from './palettes';
import {
  AREA_SIZES_KM,
  DEFAULT_SETTINGS,
  MAX_CANOPY_AREA_KM,
  SUITABILITY_CONTROLS,
  type AreaKm,
  type BaseMapId,
  type CampingSettings,
} from './settings';

export interface PanelHandlers {
  /** Area size, vegetation option: changes that need a new analysis. */
  onAreaChange(patch: Partial<Pick<CampingSettings, 'areaKm' | 'canopy'>>): void;
  /** Layer, palette, opacity, base map, overlays: changes that only redraw. */
  onViewChange(
    patch: Partial<Pick<CampingSettings, 'layer' | 'palette' | 'opacity' | 'base' | 'overlays'>>,
  ): void;
  /** Slider and checkbox changes of the suitability model (fired on every input). */
  onSuitabilityChange(params: SuitabilityParams): void;
  onLocate(): void;
}

export interface Panel {
  setStatus(text: string): void;
  /** Shows the legend of the active layer with the active palette. */
  setLegend(layer: LayerId, palette: PaletteId): void;
  /** The link to the panorama for the chosen spot, or null when nothing is chosen. */
  setPanoramaLink(href: string | null): void;
  setOpen(open: boolean): void;
  /** Keeps the vegetation checkbox in step with the chosen area. */
  syncFrom(settings: CampingSettings): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

function selectOf<T extends string>(
  options: readonly { value: T; label: string }[],
  current: T,
  onChange: (value: T) => void,
): HTMLSelectElement {
  const select = el('select');
  for (const o of options) select.append(el('option', { value: o.value, textContent: o.label }));
  select.value = current;
  select.onchange = () => onChange(select.value as T);
  return select;
}

function field(label: string, control: HTMLElement, help?: string): HTMLLabelElement {
  const row = el('label', { className: 'field' }, el('span', { textContent: label }), control);
  if (help) row.append(el('small', { textContent: help }));
  return row;
}

function section(title: string, open: boolean, ...children: Node[]): HTMLDetailsElement {
  const details = el('details', { open }, el('summary', { textContent: title }), ...children);
  return details;
}

/** Builds the side panel: status, legend, and every setting with short explanations. */
export function createPanel(
  parent: HTMLElement,
  initial: CampingSettings,
  handlers: PanelHandlers,
): Panel {
  let settings = initial;
  let suitability = initial.suitability;

  const status = el('p', { className: 'status', textContent: 'Tap the map to choose a spot.' });
  status.setAttribute('role', 'status');
  const legendBar = el('div', { className: 'legend-bar' });
  const legendWorst = el('span');
  const legendBest = el('span');
  const legend = el(
    'div',
    { className: 'legend' },
    legendBar,
    el('div', { className: 'legend-ends' }, legendWorst, legendBest),
  );
  const panorama = el('a', {
    className: 'button secondary',
    textContent: 'See the panorama from here',
  });
  panorama.hidden = true;

  // Area and heatmap.
  const canopy = el('input', { type: 'checkbox', checked: initial.canopy });
  const canopyRow = el(
    'label',
    { className: 'check' },
    canopy,
    el('span', {
      textContent: `Use vegetation height (large download, areas up to ${MAX_CANOPY_AREA_KM} km)`,
    }),
  );
  canopy.onchange = () => handlers.onAreaChange({ canopy: canopy.checked });
  const area = selectOf(
    AREA_SIZES_KM.map((a) => ({ value: String(a), label: `${a} x ${a} km` })),
    String(initial.areaKm),
    (v) => handlers.onAreaChange({ areaKm: Number(v) as AreaKm }),
  );
  const layer = selectOf(
    (Object.keys(LAYERS) as LayerId[]).map((id) => ({ value: id, label: LAYERS[id].label })),
    initial.layer,
    (v) => handlers.onViewChange({ layer: v }),
  );
  const palette = selectOf(
    (Object.keys(PALETTES) as PaletteId[]).map((id) => ({ value: id, label: PALETTES[id].label })),
    initial.palette,
    (v) => handlers.onViewChange({ palette: v }),
  );
  const opacity = el('input', {
    type: 'range',
    min: '0.1',
    max: '1',
    step: '0.05',
    value: String(initial.opacity),
  });
  opacity.oninput = () => handlers.onViewChange({ opacity: Number(opacity.value) });

  // The pitch model: sliders with the recommended value and a short explanation each.
  const sliders = new Map<
    keyof SuitabilityParams,
    { input: HTMLInputElement; output: HTMLOutputElement }
  >();
  const controls = SUITABILITY_CONTROLS.map((c) => {
    const input = el('input', {
      type: 'range',
      min: String(c.min),
      max: String(c.max),
      step: String(c.step),
      value: String(initial.suitability[c.key]),
    });
    const output = el('output');
    const recommended = DEFAULT_SETTINGS.suitability[c.key];
    const show = () => (output.textContent = `${Number(input.value)}${c.unit}`);
    show();
    input.oninput = () => {
      suitability = { ...suitability, [c.key]: Number(input.value) };
      show();
      handlers.onSuitabilityChange(suitability);
    };
    sliders.set(c.key, { input, output });
    const head = el(
      'div',
      { className: 'slider-head' },
      el('span', { textContent: c.label }),
      output,
    );
    return el(
      'div',
      { className: 'slider' },
      head,
      input,
      el('small', { textContent: `${c.help} Recommended: ${recommended}${c.unit}.` }),
    );
  });
  const water = el('input', { type: 'checkbox', checked: initial.suitability.excludeWater });
  water.onchange = () => {
    suitability = { ...suitability, excludeWater: water.checked };
    handlers.onSuitabilityChange(suitability);
  };
  const reset = el('button', {
    type: 'button',
    className: 'button secondary',
    textContent: 'Use recommended values',
  });
  reset.onclick = () => {
    suitability = DEFAULT_SETTINGS.suitability;
    for (const [key, s] of sliders) {
      s.input.value = String(suitability[key]);
      s.input.dispatchEvent(new Event('input'));
    }
    water.checked = suitability.excludeWater;
    handlers.onSuitabilityChange(suitability);
  };

  // Map: base layer and overlays.
  const base = selectOf<BaseMapId>(
    [
      { value: 'map', label: 'National map' },
      { value: 'aerial', label: 'Aerial image' },
    ],
    initial.base,
    (v) => handlers.onViewChange({ base: v }),
  );
  const overlayBoxes = new Map<string, HTMLInputElement>();
  const overlayGroup = (group: 'paths' | 'protected', title: string) =>
    el(
      'fieldset',
      { className: 'overlay-group' },
      el('legend', { textContent: title }),
      ...OVERLAYS.filter((o) => o.group === group).map((o) => {
        const box = el('input', { type: 'checkbox', checked: initial.overlays.includes(o.id) });
        box.onchange = () => {
          const on = new Set(settings.overlays);
          if (box.checked) on.add(o.id);
          else on.delete(o.id);
          settings = { ...settings, overlays: [...on] };
          handlers.onViewChange({ overlays: settings.overlays });
        };
        overlayBoxes.set(o.id, box);
        return el(
          'label',
          { className: 'check' },
          box,
          el('span', {}, o.label, el('small', { textContent: o.note })),
        );
      }),
    );

  const locate = el('button', {
    type: 'button',
    className: 'button secondary',
    textContent: 'Use my location',
  });
  locate.onclick = handlers.onLocate;

  const body = el(
    'section',
    { className: 'panel' },
    el('h1', { textContent: 'Summit Sketch' }),
    el('p', {
      className: 'tagline',
      textContent: 'Find flat, quiet places to camp in Switzerland.',
    }),
    status,
    legend,
    panorama,
    locate,
    section(
      'Area and heatmap',
      true,
      field('Area size', area, 'The square around the spot you tap.'),
      canopyRow,
      field('Heatmap', layer),
      field('Colours', palette),
      field('Opacity', opacity),
    ),
    section(
      'Tune the pitch',
      false,
      ...controls,
      el(
        'label',
        { className: 'check' },
        water,
        el(
          'span',
          {},
          'Rule out lakes',
          el('small', {
            textContent:
              'Lakes are perfectly flat in the terrain data, so they would otherwise look ideal.',
          }),
        ),
      ),
      reset,
    ),
    section(
      'Map and overlays',
      false,
      field('Base map', base),
      overlayGroup('paths', 'Hiking'),
      overlayGroup('protected', 'Protected areas (check the rules that apply)'),
    ),
  );

  const toggle = el('button', {
    type: 'button',
    className: 'panel-toggle',
    textContent: 'Options',
  });
  toggle.setAttribute('aria-expanded', 'true');

  // While the panel is closed, a chip at the bottom keeps the result and the legend in sight.
  const chipText = el('span');
  const chipBar = el('div', { className: 'legend-bar' });
  const chip = el('button', { type: 'button', className: 'status-chip' }, chipText, chipBar);
  chip.setAttribute('aria-label', 'Result summary. Open the options');
  chip.hidden = true;
  chip.onclick = () => setOpen(true);

  const setOpen = (open: boolean) => {
    body.hidden = !open;
    chip.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.onclick = () => setOpen(body.hidden !== false);

  parent.append(toggle, body, chip);
  const narrow = matchMedia('(max-width: 640px)').matches;
  setOpen(!narrow);

  return {
    setStatus(text) {
      status.textContent = text;
      chipText.textContent = text;
    },
    setLegend(id, paletteId) {
      const def = LAYERS[id];
      legendBar.style.background = def.fixedColor
        ? `rgb(${def.fixedColor.join(',')})`
        : paletteGradientCss(paletteId);
      chipBar.style.background = legendBar.style.background;
      legendWorst.textContent = def.worst;
      legendBest.textContent = def.best;
    },
    setPanoramaLink(href) {
      panorama.hidden = href === null;
      if (href) panorama.href = href;
    },
    setOpen,
    syncFrom(next) {
      settings = next;
      canopy.checked = next.canopy;
      canopy.disabled = next.areaKm > MAX_CANOPY_AREA_KM;
    },
  };
}
