import type { SuitabilityParams } from './analysis';
import { checkRow, el, field, group, section, selectOf, sliderRow, tabs } from './dom';
import { LAYERS, type LayerId } from './heatmap';
import { OVERLAYS } from './overlays';
import { PALETTES, paletteGradientCss, type PaletteId } from './palettes';
import type { AreaInfo } from './pipeline';
import { rulesNodes, type RulesState } from './rulesView';
import type { NearbyParams } from './scoring';
import { formatSignedMeters, type SpotItem } from './summary';
import {
  AREA_SIZES_KM,
  DEFAULT_SETTINGS,
  MAX_CANOPY_AREA_KM,
  NEARBY_CONTROLS,
  sanitizeSuitability,
  SUITABILITY_CONTROLS,
  type AreaKm,
  type CampingSettings,
} from './settings';

type ViewPatch = Partial<
  Pick<CampingSettings, 'layer' | 'palette' | 'opacity' | 'overlays' | 'showDrinking'>
>;
type ModelPatch = Partial<Pick<CampingSettings, 'suitability' | 'nearby' | 'hideProtected'>>;

export interface PanelHandlers {
  /** Area size and the vegetation option: changes that need a new analysis. */
  onAreaChange(patch: Partial<Pick<CampingSettings, 'areaKm' | 'canopy'>>): void;
  /** Layer, palette, opacity, base map, overlays, markers: changes that only redraw. */
  onViewChange(patch: ViewPatch): void;
  /** Changes of the scoring model, fired on every slider movement. */
  onModelChange(patch: ModelPatch): void;
  onSpotSelect(rank: number): void;
  onLocate(): void;
  /** The user opened or closed the panel with the menu button (persisted by the caller). */
  onOpenChange(open: boolean): void;
}

export interface Panel {
  setStatus(text: string): void;
  /** Notes about data that could not be loaded (empty list clears them). */
  setWarnings(texts: readonly string[]): void;
  /** Shows the legend of the active layer with the active palette. */
  setLegend(layer: LayerId, palette: PaletteId): void;
  /** The link to the panorama for the chosen spot, or null when nothing is chosen. */
  setPanoramaLink(href: string | null): void;
  /** The list of best spots; `emptyText` says why there are none. */
  setSpots(items: readonly SpotItem[], emptyText?: string): void;
  setAreas(areas: readonly AreaInfo[]): void;
  /** The camping rules that apply at the chosen spot (canton, Bundesland, commune). */
  setRules(state: RulesState): void;
  setOpen(open: boolean): void;
  /** Keeps the vegetation checkbox in step with the chosen area. */
  syncFrom(settings: CampingSettings): void;
}

/** Best spots shown in the chip while the panel is closed. */
const CHIP_SPOTS = 3;
const NO_SPOTS = 'Choose a spot on the map to see the best places around it.';
const NO_AREAS = 'No protected areas from the federal inventories here.';

/** The "Tune the pitch" section: one slider per threshold, and a reset button. */
function pitchSection(
  initial: SuitabilityParams,
  onChange: (params: SuitabilityParams) => void,
): HTMLElement {
  let params = initial;
  const sliders = new Map<keyof SuitabilityParams, ReturnType<typeof sliderRow>>();
  const rows = SUITABILITY_CONTROLS.map((c) => {
    // Sanitizing also derives the values that follow from a slider (the slope limit).
    const row = sliderRow({ ...c, value: initial[c.key] }, (value) =>
      onChange((params = sanitizeSuitability({ ...params, [c.key]: value }))),
    );
    sliders.set(c.key, row);
    return row.node;
  });
  const reset = el('button', {
    type: 'button',
    className: 'button secondary',
    textContent: 'Use recommended values',
  });
  reset.onclick = () => {
    params = DEFAULT_SETTINGS.suitability;
    for (const [key, row] of sliders) row.set(params[key] as number);
    onChange(params);
  };
  return group('Tune the pitch', ...rows, reset);
}

/**
 * The "Trails, water and drinking water" section: one signed slider each (plus = within that
 * distance, minus = at least that far away, "Off" in the middle).
 */
function nearbySection(
  initial: NearbyParams,
  showDrinking: boolean,
  onNearby: (nearby: NearbyParams) => void,
  onDrinking: (show: boolean) => void,
): HTMLElement {
  let nearby = initial;
  const rows = NEARBY_CONTROLS.map(
    (c) =>
      sliderRow({ ...c, unit: ' m', value: initial[c.key], format: formatSignedMeters }, (value) =>
        onNearby((nearby = { ...nearby, [c.key]: value })),
      ).node,
  );
  const markers = checkRow('Show drinking-water sources on the map', showDrinking, onDrinking);
  return group('Trails and water', ...rows, markers.node);
}

/** The overlays section: checkboxes for trails and protected areas, grouped by kind. */
function overlaysSection(
  initial: CampingSettings,
  onOverlays: (ids: string[]) => void,
): HTMLElement {
  const enabled = new Set(initial.overlays);
  const overlayGroup = (kind: 'paths' | 'protected', title: string) =>
    el(
      'fieldset',
      { className: 'overlay-group' },
      el('legend', { textContent: title }),
      ...OVERLAYS.filter((o) => o.group === kind).map(
        (o) =>
          checkRow(
            o.label,
            enabled.has(o.id),
            (on) => {
              if (on) enabled.add(o.id);
              else enabled.delete(o.id);
              onOverlays([...enabled]);
            },
            o.note,
          ).node,
      ),
    );
  return group(
    'Overlays',
    overlayGroup('paths', 'Hiking'),
    overlayGroup('protected', 'Protected areas (check the rules that apply)'),
  );
}

interface Legend {
  node: HTMLElement;
  bar: HTMLElement;
  worst: HTMLElement;
  best: HTMLElement;
}

/** The colour scale with the captions of its two ends. */
function makeLegend(): Legend {
  const bar = el('div', { className: 'legend-bar' });
  const worst = el('span');
  const best = el('span');
  const node = el(
    'div',
    { className: 'legend' },
    bar,
    el('div', { className: 'legend-ends' }, worst, best),
  );
  return { node, bar, worst, best };
}

/** A bare slider (no visible label) for the opacity of the heatmap. */
function makeOpacity(initial: number, onInput: (opacity: number) => void): HTMLInputElement {
  const input = el('input', {
    type: 'range',
    className: 'opacity',
    min: '0.1',
    max: '1',
    step: '0.05',
    value: String(initial),
  });
  input.setAttribute('aria-label', 'Heatmap opacity');
  input.oninput = () => onInput(Number(input.value));
  return input;
}

const areaText = (a: AreaInfo): string => {
  const season = !a.restricts
    ? 'listed for information, hides nothing'
    : a.period
      ? `${a.period}${a.inForce ? ' (in force today)' : ' (not in force today)'}`
      : 'all year';
  return [a.kind, season, a.rule].filter(Boolean).join(' | ');
};

/** Builds the side panel: status, legend, results and every setting with short explanations. */
export function createPanel(
  parent: HTMLElement,
  initial: CampingSettings,
  handlers: PanelHandlers,
): Panel {
  const status = el('p', { className: 'status', textContent: 'Tap the map to choose a spot.' });
  status.setAttribute('role', 'status');
  const warnings = el('div', { className: 'notice' });
  warnings.hidden = true;
  const legend = makeLegend();
  const chipLegend = makeLegend();
  const panorama = el('a', {
    className: 'button secondary',
    textContent: 'See the panorama from here',
  });
  panorama.hidden = true;
  const locate = el('button', {
    type: 'button',
    className: 'button secondary',
    textContent: 'Use my location',
  });
  locate.onclick = handlers.onLocate;

  // Results.
  const spotList = el('ol', { className: 'spot-list' });
  const spots = group('Best spots here', spotList);
  const areaList = el('ul', { className: 'area-list' });
  const hide = checkRow(
    'Hide ground where a protection is in force',
    initial.hideProtected,
    (hideProtected) => handlers.onModelChange({ hideProtected }),
    'Protections that apply only in other seasons (like winter refuges in summer) are shown but do not hide anything, and neither do nature parks and moorland landscapes, which are large and listed for information. Always check the rules of the area yourself.',
  );
  const areas = section('Protected areas in this box', false, hide.node, areaList);
  const rulesBody = el('div', { className: 'rules' }, ...rulesNodes({ state: 'none' }));
  const rules = section('Camping rules here', true, rulesBody);

  // Area and heatmap.
  const canopy = checkRow(
    `Use vegetation height (large download, areas up to ${MAX_CANOPY_AREA_KM} km)`,
    initial.canopy,
    (on) => handlers.onAreaChange({ canopy: on }),
  );
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
  const onOpacity = (opacity: number) => handlers.onViewChange({ opacity });
  const opacity = makeOpacity(initial.opacity, onOpacity);
  const chipOpacity = makeOpacity(initial.opacity, onOpacity);
  area.setAttribute('aria-label', 'Area size');

  const body = el(
    'section',
    { className: 'panel' },
    el('h1', { textContent: 'Summit Sketch' }),
    el('p', {
      className: 'tagline',
      textContent: 'Find flat, quiet places to camp in Switzerland.',
    }),
    status,
    warnings,
    el('div', { className: 'view-controls' }, legend.node, opacity, area),
    tabs([
      {
        label: 'Spots',
        content: el('div', { className: 'tab-body' }, spots, rules, areas, panorama, locate),
      },
      {
        label: 'Tune',
        content: el(
          'div',
          { className: 'tab-body' },
          pitchSection(initial.suitability, (suitability) =>
            handlers.onModelChange({ suitability }),
          ),
          nearbySection(
            initial.nearby,
            initial.showDrinking,
            (nearby) => handlers.onModelChange({ nearby }),
            (showDrinking) => handlers.onViewChange({ showDrinking }),
          ),
        ),
      },
      {
        label: 'Map',
        content: el(
          'div',
          { className: 'tab-body' },
          group(
            'Area and heatmap',
            canopy.node,
            field('Heatmap', layer),
            field('Colours', palette),
          ),
          overlaysSection(initial, (overlays) => handlers.onViewChange({ overlays })),
        ),
      },
    ]),
  );

  const toggle = el('button', {
    type: 'button',
    className: 'panel-toggle',
    textContent: '☰',
  });
  toggle.setAttribute('aria-label', 'Options');
  toggle.setAttribute('aria-expanded', 'false');

  // While the panel is closed, a chip at the bottom keeps the result, the legend and the best
  // spots in sight.
  const chipSpots = el('ol', { className: 'chip-spots' });
  const chip = el('div', { className: 'status-chip' }, chipLegend.node, chipOpacity, chipSpots);
  chip.hidden = true;

  const setOpen = (open: boolean) => {
    body.hidden = !open;
    chip.hidden = open;
    toggle.setAttribute('aria-expanded', String(open));
  };
  const userSetOpen = (open: boolean) => {
    setOpen(open);
    handlers.onOpenChange(open);
  };
  toggle.onclick = () => userSetOpen(body.hidden !== false);

  parent.append(toggle, body, chip);
  setOpen(initial.panelOpen);

  const setSpots: Panel['setSpots'] = (items, emptyText = NO_SPOTS) => {
    chipSpots.replaceChildren(
      ...items.slice(0, CHIP_SPOTS).map((s) => {
        const button = el('button', { type: 'button', textContent: s.title });
        button.onclick = () => handlers.onSpotSelect(s.rank);
        return el('li', {}, button);
      }),
    );
    if (items.length === 0)
      return spotList.replaceChildren(el('li', { className: 'empty', textContent: emptyText }));
    spotList.replaceChildren(
      ...items.map((s) => {
        const button = el(
          'button',
          { type: 'button', className: 'spot' },
          el('strong', { textContent: s.title }),
          el('small', { textContent: s.detail }),
        );
        button.onclick = () => handlers.onSpotSelect(s.rank);
        return el('li', {}, button);
      }),
    );
  };
  setSpots([]);

  return {
    setStatus(text) {
      status.textContent = text;
    },
    setWarnings(texts) {
      warnings.replaceChildren(...texts.map((t) => el('p', { textContent: t })));
      warnings.hidden = texts.length === 0;
    },
    setLegend(id, paletteId) {
      const def = LAYERS[id];
      const background = def.legend ?? paletteGradientCss(paletteId);
      for (const l of [legend, chipLegend]) {
        l.bar.style.background = background;
        l.worst.textContent = def.worst;
        l.best.textContent = def.best;
      }
    },
    setPanoramaLink(href) {
      panorama.hidden = href === null;
      if (href) panorama.href = href;
    },
    setSpots,
    setAreas(list) {
      areas.querySelector('summary')!.textContent = `Protected areas in this box (${list.length})`;
      areaList.replaceChildren(
        ...(list.length === 0
          ? [el('li', { className: 'empty', textContent: NO_AREAS })]
          : list.map((a) =>
              el(
                'li',
                {},
                el('strong', { textContent: a.name }),
                el('small', { textContent: areaText(a) }),
              ),
            )),
      );
    },
    setRules(state) {
      rulesBody.replaceChildren(...rulesNodes(state));
    },
    setOpen,
    syncFrom(next) {
      canopy.input.checked = next.canopy;
      canopy.input.disabled = next.areaKm > MAX_CANOPY_AREA_KM;
      area.value = String(next.areaKm);
      opacity.value = chipOpacity.value = String(next.opacity);
    },
  };
}
