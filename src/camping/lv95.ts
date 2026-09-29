/**
 * Swiss national grid LV95 (EPSG:2056) <-> WGS84, using swisstopo's approximate formulas
 * (accuracy about 1 m in Switzerland, plenty for a 2 m analysis grid and map overlays).
 */
export interface Lv95 {
  /** Easting, meters. */
  e: number;
  /** Northing, meters. */
  n: number;
}

export function wgs84ToLv95(lat: number, lon: number): Lv95 {
  // Auxiliary values in units of 10000 arc seconds, relative to Bern.
  const p = (lat * 3600 - 169028.66) / 10000;
  const l = (lon * 3600 - 26782.5) / 10000;
  return {
    e: 2600072.37 + 211455.93 * l - 10938.51 * l * p - 0.36 * l * p * p - 44.54 * l * l * l,
    n:
      1200147.07 +
      308807.95 * p +
      3745.25 * l * l +
      76.63 * p * p -
      194.56 * l * l * p +
      119.79 * p * p * p,
  };
}

export function lv95ToWgs84(e: number, n: number): { lat: number; lon: number } {
  // Auxiliary values in units of 1000 km, relative to Bern.
  const y = (e - 2600000) / 1e6;
  const x = (n - 1200000) / 1e6;
  const lambda =
    2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x * x - 0.0436 * y * y * y;
  const phi =
    16.9023892 +
    3.238272 * x -
    0.270978 * y * y -
    0.002528 * x * x -
    0.0447 * y * y * x -
    0.014 * x * x * x;
  return { lat: (phi * 100) / 36, lon: (lambda * 100) / 36 };
}

/** Rough extent of Switzerland and Liechtenstein, for "is this point covered?" checks. */
export function isInSwitzerland(lat: number, lon: number): boolean {
  return lat >= 45.8 && lat <= 47.85 && lon >= 5.9 && lon <= 10.55;
}
