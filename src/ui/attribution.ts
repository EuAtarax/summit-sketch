/** Attribution shown in the app footer and on every exported image. */
export const ATTRIBUTION_TEXT =
  'Elevation: Terrain Tiles (Mapzen/AWS, see sources) · Map data © OpenStreetMap contributors';

export const ATTRIBUTION_LINKS = {
  terrainSources: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  osmCopyright: 'https://www.openstreetmap.org/copyright',
} as const;

export function createAttributionFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'attribution';

  const elevation = document.createElement('a');
  elevation.href = ATTRIBUTION_LINKS.terrainSources;
  elevation.target = '_blank';
  elevation.rel = 'noopener';
  elevation.textContent = 'Elevation: Terrain Tiles (Mapzen/AWS, see sources)';

  const osm = document.createElement('a');
  osm.href = ATTRIBUTION_LINKS.osmCopyright;
  osm.target = '_blank';
  osm.rel = 'noopener';
  osm.textContent = 'Map data © OpenStreetMap contributors';

  footer.append(elevation, ' · ', osm);
  return footer;
}
