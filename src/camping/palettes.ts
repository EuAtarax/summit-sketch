export type Rgb = readonly [number, number, number];

export type PaletteId = 'green' | 'traffic' | 'viridis' | 'magma' | 'blue';

/** Colors run from the worst value (t = 0) to the best (t = 1). */
export const PALETTES: Record<PaletteId, { label: string; colors: readonly Rgb[] }> = {
  green: {
    label: 'Green',
    colors: [
      [246, 232, 140],
      [170, 210, 80],
      [70, 175, 70],
      [10, 130, 60],
    ],
  },
  traffic: {
    label: 'Traffic light',
    colors: [
      [200, 30, 40],
      [240, 140, 40],
      [240, 220, 60],
      [40, 170, 70],
    ],
  },
  viridis: {
    label: 'Viridis',
    colors: [
      [68, 1, 84],
      [59, 82, 139],
      [33, 145, 140],
      [94, 201, 98],
      [253, 231, 37],
    ],
  },
  magma: {
    label: 'Magma',
    colors: [
      [20, 10, 50],
      [110, 30, 130],
      [200, 60, 110],
      [250, 140, 90],
      [252, 240, 180],
    ],
  },
  blue: {
    label: 'Blue',
    colors: [
      [222, 235, 247],
      [140, 190, 225],
      [50, 130, 195],
      [8, 60, 140],
    ],
  },
};

export const DEFAULT_PALETTE: PaletteId = 'green';

export function isPaletteId(value: unknown): value is PaletteId {
  return typeof value === 'string' && value in PALETTES;
}

/** Color at position t in [0, 1] along a palette (clamped), interpolated between stops. */
export function paletteColor(id: PaletteId, t: number): Rgb {
  const colors = PALETTES[id].colors;
  const x = Math.min(1, Math.max(0, t)) * (colors.length - 1);
  const i = Math.min(colors.length - 2, Math.floor(x));
  const f = x - i;
  const a = colors[i]!;
  const b = colors[i + 1]!;
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

/** CSS gradient for a legend bar (worst on the left, best on the right). */
export function paletteGradientCss(id: PaletteId): string {
  const stops = Array.from({ length: 8 }, (_, i) => {
    const [r, g, b] = paletteColor(id, i / 7);
    return `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}
