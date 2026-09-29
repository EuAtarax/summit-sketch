import { describe, expect, it } from 'vitest';
import { hitTestLabel, MIN_TOUCH_PX, type LabeledPeak } from './labels';

function label(id: number, box: LabeledPeak['box']): LabeledPeak {
  return { id, name: `P${id}`, az: 0, angle: 0, elev: 3000, dist: 10_000, box };
}

/** All summits anchored at the screen point (100, 200). */
const anchorOf = () => ({ x: 100, y: 200 });

describe('hitTestLabel', () => {
  // A 80 x 20 box centered over the anchor, 30 px above it: spans x 60..140, y 150..170.
  const wide = label(1, { dx: -40, dy: -50, w: 80, h: 20 });

  it('hits inside the box and misses outside a touch-sized margin', () => {
    expect(hitTestLabel([wide], 100, 160, anchorOf, 1)).toBe(wide);
    expect(hitTestLabel([wide], 100, 240, anchorOf, 1)).toBeNull();
  });

  it('grows boxes shorter than a touch target to the minimum height', () => {
    // The box is 20 px tall; a tap 20 px above its center still counts (44 px target).
    expect(hitTestLabel([wide], 100, 160 - MIN_TOUCH_PX / 2 + 1, anchorOf, 1)).toBe(wide);
    expect(hitTestLabel([wide], 100, 160 - MIN_TOUCH_PX / 2 - 1, anchorOf, 1)).toBeNull();
  });

  it('scales the box to the screen', () => {
    expect(hitTestLabel([wide], 100 + 70, 200 - 60, anchorOf, 2)).toBe(wide); // 80 px half-width
    expect(hitTestLabel([wide], 100 + 90, 200 - 60, anchorOf, 2)).toBeNull();
  });

  it('prefers the higher-priority label where touch targets overlap', () => {
    const near = label(2, { dx: -40, dy: -48, w: 80, h: 20 });
    expect(hitTestLabel([wide, near], 100, 160, anchorOf, 1)?.id).toBe(1);
    expect(hitTestLabel([near, wide], 100, 160, anchorOf, 1)?.id).toBe(2);
  });
});
