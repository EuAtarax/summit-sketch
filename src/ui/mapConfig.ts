/** Raster tile provider for the map picker. Swap here to change providers. */
export const MAP_TILES = {
  url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  maxZoom: 19,
} as const;
