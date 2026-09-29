const CLEAR = 256;
const END_OF_INFORMATION = 257;
const FIRST_FREE = 258;
const MAX_TABLE = 4096;

/**
 * Decodes TIFF-flavored LZW (MSB-first codes of 9 to 12 bits, "early change": the code
 * width grows one code before the table is full). Stops after `outputLength` bytes.
 * Used for the tiles of swisstopo's Cloud-Optimized GeoTIFFs.
 */
export function decodeLzw(input: Uint8Array, outputLength: number): Uint8Array {
  const out = new Uint8Array(outputLength);
  // A table entry is (prefix code, last byte); `first` and `length` speed up copying.
  const prefix = new Int32Array(MAX_TABLE);
  const suffix = new Uint8Array(MAX_TABLE);
  const first = new Uint8Array(MAX_TABLE);
  const length = new Uint16Array(MAX_TABLE);
  for (let i = 0; i < 256; i++) {
    prefix[i] = -1;
    suffix[i] = i;
    first[i] = i;
    length[i] = 1;
  }

  let next = FIRST_FREE;
  let codeBits = 9;
  let bitBuffer = 0;
  let bitCount = 0;
  let pos = 0;
  let outPos = 0;
  let previous = -1;

  const readCode = (): number => {
    while (bitCount < codeBits) {
      if (pos >= input.length) return END_OF_INFORMATION;
      bitBuffer = (bitBuffer << 8) | input[pos++]!;
      bitCount += 8;
    }
    const code = (bitBuffer >>> (bitCount - codeBits)) & ((1 << codeBits) - 1);
    bitCount -= codeBits;
    bitBuffer &= (1 << bitCount) - 1;
    return code;
  };

  /** Writes the string of a code; a last string that does not fit is cut to its start. */
  const write = (code: number): void => {
    const remaining = outputLength - outPos;
    let c = code;
    let len = length[c]!;
    while (len > remaining) {
      c = prefix[c]!;
      len--;
    }
    for (let i = outPos + len - 1; i >= outPos; i--) {
      out[i] = suffix[c]!;
      c = prefix[c]!;
    }
    outPos += len;
  };

  while (outPos < outputLength) {
    const code = readCode();
    if (code === END_OF_INFORMATION) break;
    if (code === CLEAR) {
      next = FIRST_FREE;
      codeBits = 9;
      previous = -1;
      continue;
    }
    if (previous === -1) {
      write(code);
      previous = code;
      continue;
    }
    if (code < next) {
      write(code);
      suffix[next] = first[code]!;
    } else {
      // The code being defined right now: previous string plus its own first byte.
      suffix[next] = first[previous]!;
      prefix[next] = previous;
      first[next] = first[previous]!;
      length[next] = length[previous]! + 1;
      write(next);
    }
    if (next < MAX_TABLE - 1) {
      prefix[next] = previous;
      first[next] = first[previous]!;
      length[next] = length[previous]! + 1;
      next++;
    }
    if (next >= 2047 && codeBits < 12) codeBits = 12;
    else if (next >= 1023 && codeBits < 11) codeBits = 11;
    else if (next >= 511 && codeBits < 10) codeBits = 10;
    previous = code;
  }
  return out;
}
