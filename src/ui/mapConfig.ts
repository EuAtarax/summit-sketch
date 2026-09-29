export type MapLayerId = 'normal' | 'terrain' | 'satellite';

export interface MapLayerConfig {
  id: MapLayerId;
  name: string;
  /** Leaflet URL template. Providers differ in {y}/{x} order and subdomains. */
  url: string;
  subdomains?: string;
  /** Highest zoom the provider has tiles for; Leaflet upscales beyond it. */
  maxNativeZoom: number;
  maxZoom: number;
  /** Credit shown while this layer is active (HTML). Empty when the base credit covers it. */
  attribution: string;
}

/**
 * Raster tile providers for the map picker. Only free sources without keys or accounts.
 * Licenses (checked): OSM standard tiles (ODbL data, light use with attribution),
 * OpenTopoMap (CC-BY-SA, light use with attribution), EOX Sentinel-2 cloudless
 * (CC BY-NC-SA 4.0: non-commercial only, so the app must stay free with no ads or paid tier).
 */
export const MAP_LAYERS: readonly MapLayerConfig[] = [
  {
    id: 'normal',
    name: 'Map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    maxNativeZoom: 19,
    maxZoom: 19,
    attribution: '',
  },
  {
    id: 'terrain',
    name: 'Terrain',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    subdomains: 'abc',
    maxNativeZoom: 17,
    maxZoom: 19,
    attribution:
      'Terrain: SRTM | Style: <a href="https://opentopomap.org" target="_blank" rel="noopener">' +
      'OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" ' +
      'target="_blank" rel="noopener">CC-BY-SA</a>)',
  },
  {
    id: 'satellite',
    name: 'Satellite',
    // WMTS order is {z}/{y}/{x}.
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2021_3857/default/g/{z}/{y}/{x}.jpg',
    maxNativeZoom: 14,
    maxZoom: 19,
    attribution:
      '<a href="https://s2maps.eu" target="_blank" rel="noopener">Sentinel-2 cloudless</a> by ' +
      '<a href="https://eox.at" target="_blank" rel="noopener">EOX IT Services GmbH</a> ' +
      '(contains modified Copernicus Sentinel data 2021, ' +
      '<a href="https://creativecommons.org/licenses/by-nc-sa/4.0/" target="_blank" ' +
      'rel="noopener">CC BY-NC-SA 4.0</a>)',
  },
];

export const DEFAULT_MAP_LAYER: MapLayerId = 'normal';

export function isMapLayerId(value: unknown): value is MapLayerId {
  return MAP_LAYERS.some((l) => l.id === value);
}

export function layerConfig(id: MapLayerId): MapLayerConfig {
  return MAP_LAYERS.find((l) => l.id === id)!;
}

const STORAGE_KEY = 'summit-sketch:map-layer';

/** The remembered layer, or the default when nothing valid is stored. */
export function loadMapLayer(): MapLayerId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (isMapLayerId(raw)) return raw;
  } catch {
    // Storage unavailable (private mode, blocked): use the default.
  }
  return DEFAULT_MAP_LAYER;
}

export function saveMapLayer(id: MapLayerId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Not critical.
  }
}
