import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { BBox, Peak } from '../peaks/overpass';
import { attributionHtml } from './attribution';
import { layerConfig, type MapLayerId } from './mapConfig';

export interface MapPicker {
  /** Shows the tapped point (pending) or the chosen summit/point (selected). */
  setSelection(lat: number, lon: number, state: 'pending' | 'selected'): void;
  clearSelection(): void;
  focus(lat: number, lon: number, zoom: number): void;
  /** Switches the base map (normal, terrain, satellite). */
  setBaseLayer(id: MapLayerId): void;
  /** Shows selectable OSM peaks (only drawn from peaksMinZoom on). */
  setPeaks(peaks: readonly Peak[]): void;
  readonly zoom: number;
  readonly bounds: BBox;
}

const TRAIL_RED = '#C8102E';
const INK = '#1F2A33';

export function createMapPicker(
  container: HTMLElement,
  handlers: {
    onPick: (lat: number, lon: number, zoom: number) => void;
    onViewChange: (bounds: BBox, zoom: number) => void;
  },
  peaksMinZoom: number,
  initialLayer: MapLayerId,
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
  let baseLayer: L.TileLayer | null = null;
  const showBaseLayer = (id: MapLayerId) => {
    const cfg = layerConfig(id);
    baseLayer?.remove();
    baseLayer = L.tileLayer(cfg.url, {
      maxZoom: cfg.maxZoom,
      maxNativeZoom: cfg.maxNativeZoom,
      attribution: cfg.attribution,
      ...(cfg.subdomains ? { subdomains: cfg.subdomains } : {}),
    })
      .addTo(map)
      .bringToBack();
  };
  showBaseLayer(initialLayer);

  // Peaks are drawn on one canvas; many markers stay cheap.
  const peakRenderer = L.canvas({ padding: 0.2 });
  const peakLayer = L.layerGroup().addTo(map);
  let marker: L.CircleMarker | null = null;

  const bounds = (): BBox => {
    const b = map.getBounds();
    return { south: b.getSouth(), west: b.getWest(), north: b.getNorth(), east: b.getEast() };
  };

  const updatePeakVisibility = () => {
    const show = map.getZoom() >= peaksMinZoom;
    if (show && !map.hasLayer(peakLayer)) peakLayer.addTo(map);
    if (!show && map.hasLayer(peakLayer)) peakLayer.remove();
  };

  map.on('click', (e: L.LeafletMouseEvent) => {
    const { lat, lng } = e.latlng.wrap();
    handlers.onPick(lat, lng, map.getZoom());
  });
  map.on('moveend', () => {
    updatePeakVisibility();
    handlers.onViewChange(bounds(), map.getZoom());
  });

  return {
    get zoom() {
      return map.getZoom();
    },
    get bounds() {
      return bounds();
    },
    setSelection(lat, lon, state) {
      const style: L.CircleMarkerOptions =
        state === 'pending'
          ? { radius: 8, color: TRAIL_RED, weight: 2, fillOpacity: 0, dashArray: '3 3' }
          : {
              radius: 9,
              color: '#FFFFFF',
              weight: 3,
              fillColor: TRAIL_RED,
              fillOpacity: 1,
              dashArray: '',
            };
      if (marker) marker.setLatLng([lat, lon]).setStyle(style);
      else marker = L.circleMarker([lat, lon], { ...style, interactive: false }).addTo(map);
      marker.bringToFront();
    },
    clearSelection() {
      marker?.remove();
      marker = null;
    },
    focus(lat, lon, zoom) {
      map.setView([lat, lon], zoom);
    },
    setBaseLayer: showBaseLayer,
    setPeaks(peaks) {
      peakLayer.clearLayers();
      for (const p of peaks) {
        L.circleMarker([p.lat, p.lon], {
          renderer: peakRenderer,
          radius: 5,
          color: INK,
          weight: 2,
          fillColor: '#FFFFFF',
          fillOpacity: 0.9,
          interactive: false,
        }).addTo(peakLayer);
      }
      marker?.bringToFront();
      updatePeakVisibility();
    },
  };
}
