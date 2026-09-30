import { describe, expect, it } from 'vitest';
import { BLOCK, blocksFor, parseRange, sliceBlocks } from './blocks.js';

describe('parseRange', () => {
  it('reads one closed range and rejects everything else', () => {
    expect(parseRange('bytes=0-65535')).toEqual({ start: 0, end: 65535 });
    expect(parseRange('bytes=100-')).toBeNull();
    expect(parseRange('bytes=-500')).toBeNull();
    expect(parseRange('bytes=0-1,5-9')).toBeNull();
    expect(parseRange('bytes=9-5')).toBeNull();
    expect(parseRange(null)).toBeNull();
  });
});

describe('blocksFor and sliceBlocks', () => {
  // Three blocks whose bytes are their offset in the file modulo 251.
  const file = Uint8Array.from({ length: 3 * BLOCK }, (_, i) => i % 251);
  const blockAt = (k) => file.subarray(k * BLOCK, (k + 1) * BLOCK);

  it('cuts a range inside one block', () => {
    expect(blocksFor(10, 20)).toEqual([0]);
    expect(Array.from(sliceBlocks([blockAt(0)], 0, 10, 20))).toEqual(
      Array.from(file.subarray(10, 21)),
    );
  });

  it('joins a range across block borders', () => {
    const start = BLOCK - 5;
    const end = 2 * BLOCK + 7;
    const indexes = blocksFor(start, end);
    expect(indexes).toEqual([0, 1, 2]);
    const out = sliceBlocks(indexes.map(blockAt), 0, start, end);
    expect(out.length).toBe(end - start + 1);
    expect(Array.from(out)).toEqual(Array.from(file.subarray(start, end + 1)));
  });

  it('stops at a short last block (the end of the file)', () => {
    const last = file.subarray(2 * BLOCK, 2 * BLOCK + 100);
    const out = sliceBlocks([last], 2, 2 * BLOCK + 50, 2 * BLOCK + 500);
    expect(out.length).toBe(50);
  });
});
