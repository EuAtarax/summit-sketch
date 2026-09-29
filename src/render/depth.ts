/** Depth bands and snowline, shared by the styles. */

/** Band edges in km: 0–5, 5–15, 15–40, 40–100, 100+. */
export const BAND_EDGES_KM = [5, 15, 40, 100] as const;
export const BAND_COUNT = BAND_EDGES_KM.length + 1;

/** Depth band index (0 = nearest) for a distance in meters. */
export function bandOf(distM: number): number {
  const km = distM / 1000;
  for (let i = 0; i < BAND_EDGES_KM.length; i++) if (km < BAND_EDGES_KM[i]!) return i;
  return BAND_EDGES_KM.length;
}

/** Continuous depth on a log scale: 0 at 1 km (or nearer), 1 at the radius. */
export function depthT(distM: number, radiusM: number): number {
  const t = Math.log(Math.max(distM, 1000) / 1000) / Math.log(radiusM / 1000);
  return Math.min(1, Math.max(0, t));
}

/** Artistic snowline: 5300 − 55·|lat| meters (adjustable in the style options). */
export function snowlineFor(lat: number): number {
  return 5300 - 55 * Math.abs(lat);
}

/**
 * Apparent thickness (degrees) of the snow band under a crest: proportional to the height
 * above the snowline, seen from `distM` away, capped so it stays a cap and not a blanket.
 */
export function snowBandDeg(elevM: number, snowlineM: number, distM: number): number {
  const above = elevM - snowlineM;
  if (above <= 0) return 0;
  const depthM = Math.min(above * 0.6, 900);
  return (Math.atan2(depthM, distM) * 180) / Math.PI;
}

/** Linear blend of two #rrggbb colors. */
export function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (p: number, s: number) => (p >> s) & 255;
  const c = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
