import L from 'leaflet';
import { CREDITS, OVERLAYS, overlayTileUrl } from './overlays';
import type { BaseMapId } from './settings';

const SWITZERLAND_BOUNDS: L.LatLngBoundsLiteral = [
  [45.8, 5.95],
  [47.85, 10.55],
];
export const SWISSTOPO =
  '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const BASES: Record<BaseMapId, string> = {
  map: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  aerial:
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
};
/** Pane above the heatmap for trails, protected areas and markers, so they stay readable. */
export const OVERLAY_PANE = 'overlays';

/** A central-Switzerland tile (zoom 9) per base map: the preview on the switch button. */
const PREVIEW_TILE = '3857/9/268/180.jpeg';
const previewUrl = (id: BaseMapId): string =>
  BASES[id].replace(/3857\/\{z\}\/\{x\}\/\{y\}\.jpeg$/, PREVIEW_TILE);
const SWITCH_LABEL: Record<BaseMapId, string> = { map: 'Map', aerial: 'Aerial' };

export interface BaseMap {
  map: L.Map;
  showBase(id: BaseMapId): void;
  /** Shows exactly the overlays with these ids (see overlays.ts) and hides the others. */
  showOverlays(ids: readonly string[]): void;
}

/**
 * A square in the bottom-right corner, above the zoom buttons, that shows the *other* base map
 * as a preview and switches to it on click (as in Google Maps).
 */
function baseSwitch(initial: BaseMapId, onSwitch: (next: BaseMapId) => void): L.Control {
  const other = (id: BaseMapId): BaseMapId => (id === 'map' ? 'aerial' : 'map');
  let current = initial;
  const control = new L.Control({ position: 'bottomright' });
  control.onAdd = () => {
    const button = L.DomUtil.create('button', 'base-switch') as HTMLButtonElement;
    button.type = 'button';
    const caption = L.DomUtil.create('span', 'base-switch-label', button);
    const refresh = () => {
      const next = other(current);
      button.style.backgroundImage = `url(${previewUrl(next)})`;
      caption.textContent = SWITCH_LABEL[next];
      button.setAttribute(
        'aria-label',
        `Switch to the ${SWITCH_LABEL[next].toLowerCase()} base map`,
      );
    };
    refresh();
    L.DomEvent.disableClickPropagation(button);
    button.onclick = () => {
      current = other(current);
      onSwitch(current);
      refresh();
    };
    return button;
  };
  return control;
}

/** The swisstopo map with its credit line, a base-layer switch and toggleable overlays. */
export function createBaseMap(
  container: HTMLElement,
  initialBase: BaseMapId,
  onBaseChange: (id: BaseMapId) => void,
): BaseMap {
  const map = L.map(container, { zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Added after the zoom buttons so it sits above them (bottom corners stack upwards).
  let base: L.TileLayer | null = null;
  L.control
    .attribution({ prefix: false, position: 'bottomleft' })
    .addAttribution(`Terrain: swissALTI3D ${SWISSTOPO}`)
    .addTo(map);
  map.fitBounds(SWITZERLAND_BOUNDS);
  map.createPane(OVERLAY_PANE).style.zIndex = '450';

  const overlays = new Map<string, L.TileLayer>();

  const showBase = (id: BaseMapId): void => {
    base?.remove();
    base = L.tileLayer(BASES[id], {
      maxNativeZoom: id === 'aerial' ? 20 : 18,
      maxZoom: 20,
      attribution: SWISSTOPO,
    })
      .addTo(map)
      .bringToBack();
  };
  baseSwitch(initialBase, (next) => {
    showBase(next);
    onBaseChange(next);
  }).addTo(map);

  return {
    map,
    showBase,
    showOverlays(ids) {
      for (const [id, layer] of overlays) {
        if (!ids.includes(id)) {
          layer.remove();
          overlays.delete(id);
        }
      }
      for (const def of OVERLAYS) {
        if (!ids.includes(def.id) || overlays.has(def.id)) continue;
        overlays.set(
          def.id,
          L.tileLayer(overlayTileUrl(def.layer), {
            pane: OVERLAY_PANE,
            opacity: 0.75,
            maxNativeZoom: 18,
            maxZoom: 20,
            attribution: CREDITS[def.credit],
          }).addTo(map),
        );
      }
    },
  };
}
