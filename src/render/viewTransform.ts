/** Cylindrical projection of azimuth/elevation angle onto a canvas, with wrap-around. */
export interface ViewTransform {
  width: number;
  height: number;
  azStart: number; // azimuth at x = 0 (wraps)
  pxPerDeg: number;
  exaggeration: number; // vertical scale factor, 1 = true angles
  angleAtTop: number;
  azToX(az: number): number;
  angleToY(angle: number): number;
}

/** Angle difference folded into [-180, 180). */
export function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

/** Azimuth folded into [0, 360). */
export function wrap360(a: number): number {
  return ((a % 360) + 360) % 360;
}

export function createViewTransform(v: {
  width: number;
  height: number;
  azStart: number;
  pxPerDeg: number;
  angleAtTop: number;
  exaggeration?: number;
}): ViewTransform {
  const exaggeration = v.exaggeration ?? 1;
  const azCenter = v.azStart + v.width / (2 * v.pxPerDeg);
  return {
    width: v.width,
    height: v.height,
    azStart: wrap360(v.azStart),
    pxPerDeg: v.pxPerDeg,
    exaggeration,
    angleAtTop: v.angleAtTop,
    // Measured from the view center, so points just left of azStart get negative x
    // instead of jumping a full turn to the right.
    azToX: (az) => v.width / 2 + wrap180(az - azCenter) * v.pxPerDeg,
    angleToY: (angle) => (v.angleAtTop - angle) * v.pxPerDeg * exaggeration,
  };
}

/** Grid spacing in degrees so that lines are at least minPx apart. */
export function gridStep(pxPerDeg: number, minPx: number): number {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 45, 90]) if (s * pxPerDeg >= minPx) return s;
  return 90;
}
