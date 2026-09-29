import { describe, expect, it } from 'vitest';
import {
  isPaletteId,
  PALETTES,
  paletteColor,
  paletteGradientCss,
  type PaletteId,
} from './palettes';

const ids = Object.keys(PALETTES) as PaletteId[];

describe('palettes', () => {
  it.each(ids)('%s has endpoints, valid channels and clamps outside [0, 1]', (id) => {
    const colors = PALETTES[id].colors;
    expect(colors.length).toBeGreaterThanOrEqual(3);
    for (const c of colors) for (const ch of c) expect(ch >= 0 && ch <= 255).toBe(true);
    expect(paletteColor(id, 0)).toEqual(colors[0]);
    expect(paletteColor(id, 1)).toEqual(colors[colors.length - 1]);
    expect(paletteColor(id, -5)).toEqual(colors[0]);
    expect(paletteColor(id, 9)).toEqual(colors[colors.length - 1]);
  });

  it('interpolates halfway between two neighbouring stops', () => {
    // Two-stop check on the traffic light: t = 1/3 lies exactly on its second color.
    expect(paletteColor('traffic', 1 / 3).map(Math.round)).toEqual([240, 140, 40]);
    const mid = paletteColor('blue', 1 / 6); // halfway between stops 0 and 1
    expect(mid.map(Math.round)).toEqual([181, 213, 236]);
  });

  it('recognizes only known ids and renders a legend gradient', () => {
    expect(isPaletteId('magma')).toBe(true);
    expect(isPaletteId('rainbow')).toBe(false);
    expect(isPaletteId(3)).toBe(false);
    expect(paletteGradientCss('green')).toMatch(/^linear-gradient\(90deg, rgb\(/);
  });
});
