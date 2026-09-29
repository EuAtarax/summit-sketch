import { describe, expect, it } from 'vitest';
import {
  distanceTransform,
  fillPolygon,
  rasterizeLines,
  rasterizePoints,
  type Point,
} from './raster';

/** A 20 x 20 grid of 2 m cells; the north-west corner is at E 1000, N 2040. */
const G = { e0: 1000, n0: 2040, cell: 2, width: 20, height: 20 };
const at = (col: number, row: number) => row * G.width + col;
/** Center of a cell in LV95. */
const center = (col: number, row: number): Point => [
  G.e0 + (col + 0.5) * G.cell,
  G.n0 - (row + 0.5) * G.cell,
];

describe('rasterizeLines', () => {
  it('marks the cells along a horizontal line and nothing else', () => {
    const mask = rasterizeLines([[center(2, 5), center(15, 5)]], G);
    for (let col = 2; col <= 15; col++) expect(mask[at(col, 5)]).toBe(1);
    expect(mask[at(1, 5)]).toBe(0);
    expect(mask[at(16, 5)]).toBe(0);
    expect(mask[at(8, 4)]).toBe(0);
    expect(mask[at(8, 6)]).toBe(0);
  });

  it('follows a diagonal without gaps and ignores parts outside the grid', () => {
    const mask = rasterizeLines([[center(0, 0), center(9, 9), [G.e0 + 500, G.n0 - 500]]], G);
    for (let i = 0; i <= 9; i++) expect(mask[at(i, i)]).toBe(1);
    expect(mask.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(10);
  });
});

describe('rasterizePoints', () => {
  it('marks the cell of each point and skips points outside', () => {
    const mask = rasterizePoints([center(3, 4), center(3, 4), [0, 0]], G);
    expect(mask[at(3, 4)]).toBe(1);
    expect(mask.reduce((a, b) => a + b, 0)).toBe(1);
  });
});

describe('distanceTransform', () => {
  it('gives Euclidean distances in meters from a single marked cell', () => {
    const mask = rasterizePoints([center(10, 10)], G);
    const d = distanceTransform(mask, G.width, G.height, G.cell);
    expect(d[at(10, 10)]).toBe(0);
    expect(d[at(13, 14)]).toBeCloseTo(5 * G.cell, 5); // 3-4-5 triangle
    expect(d[at(10, 15)]).toBeCloseTo(5 * G.cell, 5);
    expect(d[at(0, 0)]).toBeCloseTo(Math.hypot(10, 10) * G.cell, 4);
  });

  it('uses the nearest of several sources', () => {
    const mask = rasterizePoints([center(2, 2), center(17, 2)], G);
    const d = distanceTransform(mask, G.width, G.height, G.cell);
    expect(d[at(9, 2)]).toBeCloseTo(7 * G.cell, 5); // nearer to the left source
    expect(d[at(12, 2)]).toBeCloseTo(5 * G.cell, 5); // nearer to the right source
  });

  it('matches a brute-force computation on a random layout', () => {
    const pts: Point[] = [];
    let seed = 7;
    for (let i = 0; i < 6; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const col = seed % 20;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      pts.push(center(col, seed % 20));
    }
    const mask = rasterizePoints(pts, G);
    const d = distanceTransform(mask, G.width, G.height, G.cell);
    const marked: [number, number][] = [];
    for (let row = 0; row < 20; row++)
      for (let col = 0; col < 20; col++) if (mask[at(col, row)]) marked.push([col, row]);
    for (let row = 0; row < 20; row++) {
      for (let col = 0; col < 20; col++) {
        const best = Math.min(...marked.map(([c, r]) => Math.hypot(c - col, r - row))) * G.cell;
        expect(d[at(col, row)]).toBeCloseTo(best, 4);
      }
    }
  });

  it('is Infinity when nothing is marked', () => {
    const d = distanceTransform(new Uint8Array(G.width * G.height), G.width, G.height, G.cell);
    expect(d[at(5, 5)]).toBe(Infinity);
  });
});

describe('fillPolygon', () => {
  const square = (c0: number, r0: number, c1: number, r1: number): Point[] => [
    [G.e0 + c0 * G.cell, G.n0 - r0 * G.cell],
    [G.e0 + c1 * G.cell, G.n0 - r0 * G.cell],
    [G.e0 + c1 * G.cell, G.n0 - r1 * G.cell],
    [G.e0 + c0 * G.cell, G.n0 - r1 * G.cell],
  ];
  const count = (m: Uint8Array, v: number) => m.reduce((a, b) => a + (b === v ? 1 : 0), 0);

  it('fills exactly the cells whose centers are inside', () => {
    const target = new Uint8Array(G.width * G.height);
    fillPolygon(target, [square(4, 3, 10, 9)], G, 5);
    expect(count(target, 5)).toBe(6 * 6);
    expect(target[at(4, 3)]).toBe(5);
    expect(target[at(9, 8)]).toBe(5);
    expect(target[at(10, 8)]).toBe(0);
    expect(target[at(3, 3)]).toBe(0);
  });

  it('leaves holes empty (even-odd rule)', () => {
    const target = new Uint8Array(G.width * G.height);
    fillPolygon(target, [square(2, 2, 14, 14), square(6, 6, 10, 10)], G, 1);
    expect(count(target, 1)).toBe(12 * 12 - 4 * 4);
    expect(target[at(7, 7)]).toBe(0);
  });

  it('clips polygons that extend past the grid and ignores far-away ones', () => {
    const target = new Uint8Array(G.width * G.height);
    fillPolygon(target, [square(-10, -10, 5, 5)], G, 2);
    expect(count(target, 2)).toBe(25);
    fillPolygon(target, [square(100, 100, 110, 110)], G, 3);
    expect(count(target, 3)).toBe(0);
  });

  it('lets a later fill overwrite an earlier one', () => {
    const target = new Uint8Array(G.width * G.height);
    fillPolygon(target, [square(2, 2, 12, 12)], G, 1);
    fillPolygon(target, [square(8, 8, 16, 16)], G, 2);
    expect(target[at(9, 9)]).toBe(2);
    expect(target[at(3, 3)]).toBe(1);
  });
});
