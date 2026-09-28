import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { attributionHtml } from './attribution';
import { MAP_TILES } from './mapConfig';

export interface MapPicker {
  /** Shows the tapped point (pending) or the snapped summit (selected). */
  setSelection(lat: number, lon: number, state: 'pending' | 'selected'): void;
  clearSelection(): void;
  focus(lat: number, lon: number, zoom: number): void;
  invalidateSize(): void;
}

const TRAIL_RED = '#C8102E';

export function createMapPicker(
  container: HTMLElement,
  onPick: (lat: number, lon: number) => void,
): MapPicker {
  const map = L.map(container, {
    center: [25, 10],
    zoom: 3,
    worldCopyJump: true,
    zoomControl: false,
    attributionControl: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  L.control
    .attribution({ prefix: false, position: 'bottomleft' })
    .addAttribution(attributionHtml())
    .addTo(map);
  L.tileLayer(MAP_TILES.url, { maxZoom: MAP_TILES.maxZoom }).addTo(map);

  let marker: L.CircleMarker | null = null;

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng.wrap();
    onPick(lat, lng);
  });

  return {
    setSelection(lat, lon, state) {
      const style: L.CircleMarkerOptions =
        state === 'pending'
          ? { radius: 8, color: TRAIL_RED, weight: 2, fillOpacity: 0, dashArray: '3 3' }
          : { radius: 9, color: '#FFFFFF', weight: 3, fillColor: TRAIL_RED, fillOpacity: 1 };
      if (marker) marker.setLatLng([lat, lon]).setStyle(style);
      else marker = L.circleMarker([lat, lon], { ...style, interactive: false }).addTo(map);
    },
    clearSelection() {
      marker?.remove();
      marker = null;
    },
    focus(lat, lon, zoom) {
      map.setView([lat, lon], zoom);
    },
    invalidateSize() {
      map.invalidateSize();
    },
  };
}
