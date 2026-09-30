import L from 'leaflet';
import { layerConfig } from '../ui/mapConfig';
import { CREDITS, OVERLAYS, overlayTileUrl } from './overlays';
import type { BaseMapId } from './settings';

const SWITZERLAND_BOUNDS: L.LatLngBoundsLiteral = [
  [45.8, 5.95],
  [47.85, 10.55],
];
const AUSTRIA_BOUNDS: L.LatLngBoundsLiteral = [
  [46.35, 9.5],
  [49.05, 17.2],
];
const FRANCE_BOUNDS: L.LatLngBoundsLiteral = [
  [41.3, -5.3],
  [51.2, 9.7],
];
/** The Alps from the French side to Vienna: where the covered countries' mountains are. */
const START_BOUNDS: L.LatLngBoundsLiteral = [
  [44.0, 5.0],
  [48.6, 16.5],
];
export const SWISSTOPO =
  '© <a href="https://www.swisstopo.admin.ch" target="_blank" rel="noopener">swisstopo</a>';
const BASES: Record<BaseMapId, string> = {
  map: 'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.pixelkarte-farbe/default/current/3857/{z}/{x}/{y}.jpeg',
  aerial:
    'https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg',
};

interface TileSpec {
  url: string;
  attribution: string;
  maxNativeZoom: number;
  subdomains?: string;
  /** Only load tiles here (national maps answer 404 outside their country anyway). */
  bounds?: L.LatLngBoundsLiteral;
}

const openTopoMap = layerConfig('terrain');
const sentinel = layerConfig('satellite');

/**
 * Each base map is a stack: a map that covers everywhere at the bottom, national maps above it
 * inside their countries (the best map of each place wins).
 */
const STACKS: Record<BaseMapId, readonly TileSpec[]> = {
  map: [
    {
      url: openTopoMap.url,
      attribution: `Map data © OpenStreetMap contributors | ${openTopoMap.attribution}`,
      maxNativeZoom: 17,
      subdomains: 'abc',
    },
    { url: BASES.map, attribution: SWISSTOPO, maxNativeZoom: 18, bounds: SWITZERLAND_BOUNDS },
  ],
  aerial: [
    { url: sentinel.url, attribution: sentinel.attribution, maxNativeZoom: 14 },
    {
      url: 'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=image/jpeg',
      attribution:
        'Orthophotos © <a href="https://www.ign.fr" target="_blank" rel="noopener">IGN</a>',
      maxNativeZoom: 19,
      bounds: FRANCE_BOUNDS,
    },
    {
      url: 'https://mapsneu.wien.gv.at/basemap/bmaporthofoto30cm/normal/google3857/{z}/{y}/{x}.jpeg',
      attribution:
        'Orthophoto <a href="https://basemap.at" target="_blank" rel="noopener">basemap.at</a> (CC BY 4.0)',
      maxNativeZoom: 19,
      bounds: AUSTRIA_BOUNDS,
    },
    { url: BASES.aerial, attribution: SWISSTOPO, maxNativeZoom: 20, bounds: SWITZERLAND_BOUNDS },
  ],
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
  /** Credits the terrain data of the country being analysed (HTML). */
  setTerrainCredit(html: string): void;
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

/** The map with national base maps, its credit line, a base-layer switch and overlays. */
export function createBaseMap(
  container: HTMLElement,
  initialBase: BaseMapId,
  onBaseChange: (id: BaseMapId) => void,
): BaseMap {
  const map = L.map(container, { zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  // Added after the zoom buttons so it sits above them (bottom corners stack upwards).
  let base: L.TileLayer[] = [];
  const attribution = L.control.attribution({ prefix: false, position: 'bottomleft' }).addTo(map);
  let terrainCredit = '';
  map.fitBounds(START_BOUNDS);
  map.createPane(OVERLAY_PANE).style.zIndex = '450';

  const overlays = new Map<string, L.TileLayer>();

  const showBase = (id: BaseMapId): void => {
    for (const layer of base) layer.remove();
    // Added bottom first: within the tile pane, later layers draw on top.
    base = STACKS[id].map((spec) =>
      L.tileLayer(spec.url, {
        maxNativeZoom: spec.maxNativeZoom,
        maxZoom: 20,
        attribution: spec.attribution,
        ...(spec.subdomains ? { subdomains: spec.subdomains } : {}),
        ...(spec.bounds ? { bounds: L.latLngBounds(spec.bounds) } : {}),
      }).addTo(map),
    );
  };
  baseSwitch(initialBase, (next) => {
    showBase(next);
    onBaseChange(next);
  }).addTo(map);

  return {
    map,
    showBase,
    setTerrainCredit(html) {
      if (html === terrainCredit) return;
      if (terrainCredit) attribution.removeAttribution(terrainCredit);
      attribution.addAttribution(html);
      terrainCredit = html;
    },
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
          L.tileLayer(def.url ?? overlayTileUrl(def.layer), {
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
