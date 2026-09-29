import { describe, expect, it } from 'vitest';
import { formatBearing, formatCoords, formatDistance } from './format';

describe('formatDistance', () => {
  it.each([
    [4640, '4.6 km'],
    [9949, '9.9 km'],
    [45_300, '45 km'],
    [199_600, '200 km'],
  ])('formats %d m', (m, expected) => expect(formatDistance(m)).toBe(expected));
});

describe('formatBearing', () => {
  it.each([
    [0, '0° N'],
    [187, '187° S'],
    [359.7, '0° N'],
    [92, '92° E'],
    [-10, '350° N'],
  ])('formats %d degrees', (az, expected) => expect(formatBearing(az)).toBe(expected));
});

describe('formatCoords', () => {
  it('uses hemisphere letters', () => {
    expect(formatCoords(-17.5, -179.25)).toBe('17.5000° S, 179.2500° W');
  });
});
