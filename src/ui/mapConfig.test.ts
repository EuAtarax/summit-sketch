import { describe, expect, it } from 'vitest';
import { DEFAULT_MAP_LAYER, isMapLayerId, layerConfig, MAP_LAYERS } from './mapConfig';

describe('MAP_LAYERS', () => {
  it('offers normal, terrain and satellite with distinct ids', () => {
    expect(MAP_LAYERS.map((l) => l.id)).toEqual(['normal', 'terrain', 'satellite']);
  });

  it.each(MAP_LAYERS.map((l) => [l.id, l] as const))('%s has a usable tile template', (_id, l) => {
    for (const token of ['{z}', '{x}', '{y}']) expect(l.url).toContain(token);
    expect(l.url.startsWith('https://')).toBe(true);
    expect(l.maxNativeZoom).toBeLessThanOrEqual(l.maxZoom);
    if (l.url.includes('{s}')) expect(l.subdomains).toBeTruthy();
  });

  it('credits every layer that is not covered by the base credit', () => {
    for (const l of MAP_LAYERS) {
      if (l.id !== 'normal') expect(l.attribution).not.toBe('');
    }
    expect(layerConfig('satellite').attribution).toContain('CC BY-NC-SA');
  });

  it('validates stored ids', () => {
    expect(isMapLayerId('terrain')).toBe(true);
    expect(isMapLayerId('bing')).toBe(false);
    expect(isMapLayerId(null)).toBe(false);
    expect(DEFAULT_MAP_LAYER).toBe('normal');
  });
});
