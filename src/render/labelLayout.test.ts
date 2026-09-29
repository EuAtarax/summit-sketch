import { describe, expect, it } from 'vitest';
import { layoutLabels, type LabelCandidate, type LayoutFrame } from './labelLayout';
import type { LabelMetrics, LabeledPeak } from './labels';

const METRICS: LabelMetrics = { height: 16, padX: 4, leaderMin: 6, spacing: 2 };
const FRAME: LayoutFrame = { pxPerDeg: 10, exaggeration: 1, angleTop: 20 };
/** 6 px per character. */
const width = (name: string) => name.length * 6;

function peak(id: number, az: number, angle: number, name = `P${id}`): LabelCandidate {
  return { id, name, az, angle, elev: 0, dist: 0 };
}

/** Absolute rectangle of a placed label in frame px. */
function rectOf(l: LabeledPeak, frame = FRAME) {
  const x = l.az * frame.pxPerDeg + l.box.dx;
  const y = (frame.angleTop - l.angle) * frame.pxPerDeg * frame.exaggeration + l.box.dy;
  return { x0: x, x1: x + l.box.w, y0: y, y1: y + l.box.h };
}

/** Points along the leader from the box bottom center to the summit. */
function leaderPoints(l: LabeledPeak): [number, number][] {
  const from = { x: rectOf(l).x0 + l.box.w / 2, y: rectOf(l).y1 };
  const to = { x: l.az * FRAME.pxPerDeg, y: (FRAME.angleTop - l.angle) * FRAME.pxPerDeg };
  return Array.from({ length: 41 }, (_, i) => [
    from.x + ((to.x - from.x) * i) / 40,
    from.y + ((to.y - from.y) * i) / 40,
  ]);
}

const overlap = (a: LabeledPeak, b: LabeledPeak) => {
  const r = rectOf(a);
  const s = rectOf(b);
  return r.x0 < s.x1 && s.x0 < r.x1 && r.y0 < s.y1 && s.y0 < r.y1;
};

describe('layoutLabels', () => {
  it('centers a lone label above its summit with the minimum leader', () => {
    const [label] = layoutLabels([peak(1, 100, 5)], FRAME, width, METRICS);
    expect(label!.box.w).toBe(2 * 6 + 8);
    expect(label!.box.dx).toBe(-label!.box.w / 2);
    // Box bottom is leaderMin above the summit.
    expect(label!.box.dy + label!.box.h).toBe(-METRICS.leaderMin);
  });

  it('moves a neighbouring lower-priority label out of the way instead of overlapping', () => {
    const labels = layoutLabels([peak(1, 100, 5), peak(2, 100.5, 4)], FRAME, width, METRICS);
    expect(labels.map((l) => l.id)).toEqual([1, 2]);
    expect(overlap(labels[0]!, labels[1]!)).toBe(false);
  });

  it('keeps every leader line clear of other labels, even with slanted leaders', () => {
    const peaks = [
      peak(1, 100, 10),
      peak(2, 100, 2),
      peak(3, 100.4, 6),
      peak(4, 99.7, 4),
      peak(5, 100.2, 1),
    ];
    const labels = layoutLabels(peaks, FRAME, width, METRICS);
    expect(labels.length).toBeGreaterThan(2);
    for (const a of labels) {
      for (const b of labels) {
        if (a === b) continue;
        const box = rectOf(b);
        for (const [x, y] of leaderPoints(a)) {
          const inside = x > box.x0 && x < box.x1 && y > box.y0 && y < box.y1;
          expect(inside).toBe(false);
        }
        expect(overlap(a, b)).toBe(false);
      }
    }
  });

  it('drops labels that find no free row inside the content', () => {
    // Summit near the top (angle 19 of 20): no room above it.
    expect(layoutLabels([peak(1, 100, 19.9)], FRAME, width, METRICS)).toEqual([]);
  });

  it('gives higher-priority labels the best spot', () => {
    const labels = layoutLabels(
      [peak(9, 100, 5, 'Alpha'), peak(8, 100, 5, 'Bravo')],
      FRAME,
      width,
      METRICS,
    );
    expect(labels.map((l) => l.id)).toEqual([9, 8]);
    // The important one gets the straight-up spot, centered over its summit.
    expect(labels[0]!.box.dx).toBe(-labels[0]!.box.w / 2);
    expect(overlap(labels[0]!, labels[1]!)).toBe(false);
  });

  it('treats 0 and 360 degrees as neighbours', () => {
    const labels = layoutLabels([peak(1, 359.95, 5), peak(2, 0.05, 5)], FRAME, width, METRICS);
    expect(labels).toHaveLength(2);
    // Summits are 1 px apart across the seam: the boxes must not overlap there either.
    const period = 360 * FRAME.pxPerDeg;
    const [a, b] = labels.map((l) => rectOf(l));
    const shiftedB = { x0: b!.x0 + period, x1: b!.x1 + period, y0: b!.y0, y1: b!.y1 };
    const overlapsAcrossSeam =
      a!.x0 < shiftedB.x1 && shiftedB.x0 < a!.x1 && a!.y0 < shiftedB.y1 && shiftedB.y0 < a!.y1;
    expect(overlapsAcrossSeam).toBe(false);
  });

  it('is deterministic', () => {
    const peaks = Array.from({ length: 40 }, (_, i) => peak(i, (i * 7.3) % 360, 3 + (i % 5)));
    expect(layoutLabels(peaks, FRAME, width, METRICS)).toEqual(
      layoutLabels(peaks, FRAME, width, METRICS),
    );
  });
});
