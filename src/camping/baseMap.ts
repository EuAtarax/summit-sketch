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

export interface BaseMap {
  map: L.Map;
  showBase(id: BaseMapId): void;
  /** Shows exactly the overlays with these ids (see overlays.ts) and hides the others. */
  showOverlays(ids: readonly string[]): void;
}

/** The swisstopo map with its credit line, a base-layer switch and toggleable overlays. */
export function createBaseMap(container: HTMLElement): BaseMap {
  const map = L.map(container, { zoomControl: false, attributionControl: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control
    .attribution({ prefix: false, position: 'bottomleft' })
    .addAttribution(`Terrain: swissALTI3D ${SWISSTOPO}`)
    .addTo(map);
  map.fitBounds(SWITZERLAND_BOUNDS);
  map.createPane(OVERLAY_PANE).style.zIndex = '450';

  let base: L.TileLayer | null = null;
  const overlays = new Map<string, L.TileLayer>();

  return {
    map,
    showBase(id) {
      base?.remove();
      base = L.tileLayer(BASES[id], {
        maxNativeZoom: id === 'aerial' ? 20 : 18,
        maxZoom: 20,
        attribution: SWISSTOPO,
      })
        .addTo(map)
        .bringToBack();
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
