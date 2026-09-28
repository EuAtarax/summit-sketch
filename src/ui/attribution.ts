/** Attribution shown in the app footer and on every exported image. */
export const ATTRIBUTION_TEXT =
  'Elevation: Terrain Tiles (Mapzen/AWS, see sources) · Map data © OpenStreetMap contributors';

export const ATTRIBUTION_LINKS = {
  terrainSources: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md',
  osmCopyright: 'https://www.openstreetmap.org/copyright',
} as const;

/** The attribution line as HTML with links (for the map's attribution control). */
export function attributionHtml(): string {
  return (
    `<a href="${ATTRIBUTION_LINKS.terrainSources}" target="_blank" rel="noopener">` +
    `Elevation: Terrain Tiles (Mapzen/AWS, see sources)</a> · ` +
    `<a href="${ATTRIBUTION_LINKS.osmCopyright}" target="_blank" rel="noopener">` +
    `Map data © OpenStreetMap contributors</a>`
  );
}

export function createAttributionFooter(): HTMLElement {
  const footer = document.createElement('footer');
  footer.className = 'attribution';
  footer.innerHTML = attributionHtml();
  return footer;
}
