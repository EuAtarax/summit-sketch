import { lv95ToWgs84, wgs84ToLv95 } from './lv95';

/**
 * The metric grids the camping finder analyses in. Switzerland keeps its national grid (LV95);
 * everywhere else uses ETRS89-LAEA Europe (EPSG:3035), the EU's equal-area grid, which several
 * national data sets (Austria's among them) already come in. Its scale error stays below about
 * 1 % across the continent, so slopes computed on its 2 m cells are true to that.
 */
export type CrsId = 'EPSG:2056' | 'EPSG:3035';

export interface Crs {
  id: CrsId;
  /** WGS84 (treated as ETRS89; they differ by well under a meter in Europe) to grid meters. */
  forward(lat: number, lon: number): { e: number; n: number };
  inverse(e: number, n: number): { lat: number; lon: number };
}

export const LV95: Crs = { id: 'EPSG:2056', forward: wgs84ToLv95, inverse: lv95ToWgs84 };

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * Lambert azimuthal equal-area on the GRS80 ellipsoid (EPSG method 9820), following IOGP
 * Guidance Note 7-2.
 */
function laea(lat0: number, lon0: number, falseE: number, falseN: number): Omit<Crs, 'id'> {
  const a = 6378137;
  const f = 1 / 298.257222101;
  const e2 = 2 * f - f * f;
  const e = Math.sqrt(e2);
  const q = (phi: number) => {
    const s = Math.sin(phi);
    return (1 - e2) * (s / (1 - e2 * s * s) - (1 / (2 * e)) * Math.log((1 - e * s) / (1 + e * s)));
  };
  const phi0 = lat0 * D2R;
  const lam0 = lon0 * D2R;
  const qP = q(Math.PI / 2);
  const beta0 = Math.asin(q(phi0) / qP);
  const Rq = a * Math.sqrt(qP / 2);
  const D =
    (a * (Math.cos(phi0) / Math.sqrt(1 - e2 * Math.sin(phi0) ** 2))) / (Rq * Math.cos(beta0));
  const sinB0 = Math.sin(beta0);
  const cosB0 = Math.cos(beta0);
  return {
    forward(lat, lon) {
      const beta = Math.asin(q(lat * D2R) / qP);
      const dl = lon * D2R - lam0;
      const B =
        Rq * Math.sqrt(2 / (1 + sinB0 * Math.sin(beta) + cosB0 * Math.cos(beta) * Math.cos(dl)));
      return {
        e: falseE + B * D * Math.cos(beta) * Math.sin(dl),
        n: falseN + (B / D) * (cosB0 * Math.sin(beta) - sinB0 * Math.cos(beta) * Math.cos(dl)),
      };
    },
    inverse(east, north) {
      const x = east - falseE;
      const y = north - falseN;
      const rho = Math.hypot(x / D, D * y);
      if (rho === 0) return { lat: lat0, lon: lon0 };
      const C = 2 * Math.asin(rho / (2 * Rq));
      const betaP = Math.asin(Math.cos(C) * sinB0 + (D * y * Math.sin(C) * cosB0) / rho);
      const lam =
        lam0 +
        Math.atan2(
          x * Math.sin(C),
          D * rho * cosB0 * Math.cos(C) - D * D * y * sinB0 * Math.sin(C),
        );
      const e4 = e2 * e2;
      const e6 = e4 * e2;
      const phi =
        betaP +
        (e2 / 3 + (31 * e4) / 180 + (517 * e6) / 5040) * Math.sin(2 * betaP) +
        ((23 * e4) / 360 + (251 * e6) / 3780) * Math.sin(4 * betaP) +
        ((761 * e6) / 45360) * Math.sin(6 * betaP);
      return { lat: phi * R2D, lon: lam * R2D };
    },
  };
}

export const LAEA_EUROPE: Crs = { id: 'EPSG:3035', ...laea(52, 10, 4321000, 3210000) };

const BY_ID: Record<CrsId, Crs> = { 'EPSG:2056': LV95, 'EPSG:3035': LAEA_EUROPE };

/** The grid of a geometry; geometries without one are Swiss (LV95), as all were at first. */
export const crsOf = (g: { crs?: CrsId }): Crs => BY_ID[g.crs ?? 'EPSG:2056'];
