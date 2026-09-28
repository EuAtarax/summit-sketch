/** Spherical-earth geodesy and line-of-sight math. Pure functions. */

export const EARTH_RADIUS_M = 6_371_000;
/** Standard atmospheric refraction coefficient. */
export const REFRACTION_K = 0.13;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Apparent drop of a target at distance d due to curvature, reduced by refraction. */
export function curvatureDrop(d: number, k = REFRACTION_K): number {
  return ((d * d) / (2 * EARTH_RADIUS_M)) * (1 - k);
}

/** Apparent elevation angle (degrees) of a target of height hTarget at distance d. */
export function elevationAngleDeg(
  hTarget: number,
  hObserver: number,
  d: number,
  k = REFRACTION_K,
): number {
  return Math.atan2(hTarget - curvatureDrop(d, k) - hObserver, d) * R2D;
}

/** Longitude normalized to [-180, 180). */
export function normalizeLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

/** Point reached from (lat, lon) after distM along the initial bearing (spherical formula). */
export function destinationPoint(
  lat: number,
  lon: number,
  bearingDeg: number,
  distM: number,
): { lat: number; lon: number } {
  const delta = distM / EARTH_RADIUS_M;
  const theta = bearingDeg * D2R;
  const phi1 = lat * D2R;
  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lon * D2R +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );
  return { lat: phi2 * R2D, lon: normalizeLon(lambda2 * R2D) };
}

/** Great-circle distance in meters (haversine). */
export function distanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dPhi = (lat2 - lat1) * D2R;
  const dLambda = (lon2 - lon1) * D2R;
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLambda / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing from point 1 to point 2, degrees in [0, 360). */
export function initialBearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const phi1 = lat1 * D2R;
  const phi2 = lat2 * D2R;
  const dLambda = (lon2 - lon1) * D2R;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (((Math.atan2(y, x) * R2D) % 360) + 360) % 360;
}
