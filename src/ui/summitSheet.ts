import { formatCoords } from './format';

export const RADIUS_OPTIONS_KM = [100, 200, 300] as const;
export type RadiusKm = (typeof RADIUS_OPTIONS_KM)[number];

export interface SheetSummit {
  lat: number;
  lon: number;
  elev: number;
  /** Where the elevation comes from: the OSM ele tag or the elevation model. */
  elevSource: 'osm' | 'dem';
  name?: string;
}

export interface SummitSheet {
  showLoading(): void;
  showSummit(s: SheetSummit): void;
  showError(message: string, retry: () => void): void;
  hide(): void;
  readonly radiusKm: RadiusKm;
  setRadius(r: RadiusKm): void;
}

/** Bottom sheet for the selected summit: name, elevation, radius and the primary action. */
export function createSummitSheet(
  parent: HTMLElement,
  handlers: { onShowView: () => void; onClose: () => void },
): SummitSheet {
  const el = document.createElement('section');
  el.className = 'sheet';
  el.setAttribute('aria-live', 'polite');
  el.hidden = true;
  parent.append(el);

  let radiusKm: RadiusKm = 200;

  const closeButton = () => {
    const b = document.createElement('button');
    b.className = 'icon-button sheet-close';
    b.type = 'button';
    b.setAttribute('aria-label', 'Close');
    b.textContent = '×';
    b.onclick = handlers.onClose;
    return b;
  };

  const show = (...children: (Node | string)[]) => {
    el.replaceChildren(closeButton(), ...children);
    el.hidden = false;
  };

  const p = (text: string, cls?: string) => {
    const e = document.createElement('p');
    e.textContent = text;
    if (cls) e.className = cls;
    return e;
  };

  const radiusPicker = () => {
    const fs = document.createElement('fieldset');
    fs.className = 'segmented';
    const legend = document.createElement('legend');
    legend.textContent = 'View distance';
    fs.append(legend);
    for (const r of RADIUS_OPTIONS_KM) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'radius';
      input.value = String(r);
      input.checked = r === radiusKm;
      input.onchange = () => (radiusKm = r);
      label.append(input, document.createTextNode(`${r} km`));
      fs.append(label);
    }
    return fs;
  };

  return {
    get radiusKm() {
      return radiusKm;
    },
    setRadius(r) {
      radiusKm = r;
    },
    showLoading() {
      show(p('Finding the summit…', 'sheet-status'));
    },
    showSummit(s) {
      const h = document.createElement('h2');
      h.textContent = s.name ?? 'Selected point';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'primary-button';
      go.textContent = 'Show the view';
      go.onclick = handlers.onShowView;
      show(
        h,
        p(
          `${Math.round(s.elev)} m${s.elevSource === 'dem' ? ' (terrain model)' : ''} · ${formatCoords(s.lat, s.lon)}`,
          'sheet-meta',
        ),
        radiusPicker(),
        go,
      );
      go.focus({ preventScroll: true });
    },
    showError(message, retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'secondary-button';
      b.textContent = 'Try again';
      b.onclick = retry;
      show(p(message, 'sheet-status'), b);
    },
    hide() {
      el.hidden = true;
    },
  };
}
