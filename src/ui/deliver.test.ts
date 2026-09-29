import { describe, expect, it } from 'vitest';
import { exportFilename, slugify } from './deliver';

describe('slugify', () => {
  it.each([
    ['Zugspitze', 'zugspitze'],
    ['Östliche Griesspitze', 'ostliche-griesspitze'],
    ['Hohe Wand / Hochwand', 'hohe-wand-hochwand'],
    ['  --Mont Blanc (4808 m)-- ', 'mont-blanc-4808-m'],
    ['雪山', 'panorama'],
    ['', 'panorama'],
  ])('slugifies %s', (input, expected) => expect(slugify(input)).toBe(expected));
});

describe('exportFilename', () => {
  it('combines summit, style and kind', () => {
    expect(exportFilename('Zugspitze', 'pencil', '360')).toBe(
      'summit-sketch-zugspitze-pencil-360.png',
    );
    expect(exportFilename('Selected point', 'misty', 'view')).toBe(
      'summit-sketch-selected-point-misty-view.png',
    );
  });
});
