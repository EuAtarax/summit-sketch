import { describe, expect, it } from 'vitest';
import { buildSuggestUrl, parseSuggestions } from './swisstopo';

const item = (label: string, zoomlevel = 10) => ({
  id: 1,
  attrs: { label, lat: 46.9, lon: 8.3, zoomlevel },
});

describe('parseSuggestions', () => {
  it('splits the label into name, kind and location', () => {
    const [peak] = parseSuggestions([
      item('<i>Alpin peak</i> <b>Matterhorn Mont Cervin|Monte Cervino</b> (VS) - Zermatt'),
    ]);
    expect(peak).toMatchObject({
      name: 'Matterhorn Mont Cervin',
      description: 'Alpin peak (VS) - Zermatt',
      isPeak: true,
      zoom: 14,
      lat: 46.9,
    });
  });

  it('handles towns without a kind, with stray whitespace, and frames them wider', () => {
    const [town] = parseSuggestions([item('<b>Zermatt\n</b> (VS) - Zermatt', 9)]);
    expect(town).toMatchObject({ name: 'Zermatt', description: '(VS) - Zermatt', isPeak: false });
    expect(town!.zoom).toBe(12);
  });
});

describe('buildSuggestUrl', () => {
  it('asks for place names only, a short list, in the given language', () => {
    const url = new URL(buildSuggestUrl('Pilat', 'de'));
    expect(url.searchParams.get('searchText')).toBe('Pilat');
    expect(url.searchParams.get('type')).toBe('locations');
    expect(url.searchParams.get('limit')).toBe('6');
    expect(url.searchParams.get('lang')).toBe('de');
  });
});
