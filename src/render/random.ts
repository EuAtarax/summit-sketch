/** Seeded, allocation-free randomness. Everything is a pure function of its inputs. */

/** 32-bit integer hash of two integers (splitmix-style mixing). */
export function hash2(a: number, b: number): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Uniform value in [0, 1) for (seed, i). */
export function rand01(seed: number, i: number): number {
  return hash2(seed, i) / 4294967296;
}

/** A small sequential RNG (mulberry32) for code that needs a stream of numbers. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Smooth 1D value noise in [-1, 1]: random values at integer x, smoothstep-interpolated.
 * Continuous in x, so offsets sampled at absolute positions line up across tiles.
 */
export function noise1(seed: number, x: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const a = rand01(seed, i) * 2 - 1;
  const b = rand01(seed, i + 1) * 2 - 1;
  const s = f * f * (3 - 2 * f);
  return a + (b - a) * s;
}
