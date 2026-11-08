import 'server-only';
import sharp from "sharp";

/**
 * 64-bit DCT perceptual hash, the same construction as `imagehash.phash`: 32x32 greyscale, 2-D
 * DCT, the top-left 8x8 block, each bit set when the coefficient is above the block's median.
 *
 * HeyDarlink recomputes this server side with its own code, so the two must agree bit for bit
 * on the same JPEG. Keep the resize kernel and the median rule identical on both sides.
 */
const SIZE = 32;
const BLOCK = 8;

const COS = (() => {
  const table = new Float64Array(SIZE * SIZE);
  for (let k = 0; k < SIZE; k++) {
    for (let n = 0; n < SIZE; n++) table[k * SIZE + n] = Math.cos(((2 * n + 1) * k * Math.PI) / (2 * SIZE));
  }
  return table;
})();

export async function ambientPhash(image: Uint8Array | Buffer): Promise<string> {
  const pixels = await sharp(image)
    .greyscale()
    .resize(SIZE, SIZE, { fit: "fill", kernel: "lanczos3" })
    .raw()
    .toBuffer();
  const rows = new Float64Array(SIZE * BLOCK);
  for (let y = 0; y < SIZE; y++) {
    for (let k = 0; k < BLOCK; k++) {
      let sum = 0;
      for (let x = 0; x < SIZE; x++) sum += pixels[y * SIZE + x]! * COS[k * SIZE + x]!;
      rows[y * BLOCK + k] = sum;
    }
  }
  const block: number[] = [];
  for (let k = 0; k < BLOCK; k++) {
    for (let u = 0; u < BLOCK; u++) {
      let sum = 0;
      for (let y = 0; y < SIZE; y++) sum += rows[y * BLOCK + u]! * COS[k * SIZE + y]!;
      block.push(sum);
    }
  }
  const sorted = [...block].sort((a, b) => a - b);
  const median = (sorted[31]! + sorted[32]!) / 2;
  let bits = BigInt(0);
  for (const value of block) bits = (bits << BigInt(1)) | BigInt(value > median ? 1 : 0);
  return bits.toString(16).padStart(16, "0");
}

export function ambientHamming(a: string, b: string): number {
  let diff = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let count = 0;
  const zero = BigInt(0), one = BigInt(1);
  while (diff !== zero) {
    count += Number(diff & one);
    diff >>= one;
  }
  return count;
}

export const PHASH_PATTERN = /^[0-9a-f]{16}$/u;
