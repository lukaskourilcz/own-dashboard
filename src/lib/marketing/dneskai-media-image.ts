import 'server-only';
import { createHash } from 'node:crypto';

/**
 * What the DNESKAi media collector (#114) learns from one downloaded source picture, without changing it:
 * the sha256 of the exact bytes (the asset identity the studio renderer checks before drawing), the format
 * read from the file signature, the displayed size and a perceptual hash for near-duplicate detection.
 */

/** The formats the studio renderer decodes (`DNESKAI_IMAGE_FORMATS` in quorum/studio). SVG, GIF and the rest never reach a decoder. */
export const DNESKAI_MEDIA_FORMATS = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' },
} as const;
export type DneskaiMediaFormat = keyof typeof DNESKAI_MEDIA_FORMATS;
export type DneskaiMediaMime = (typeof DNESKAI_MEDIA_FORMATS)[DneskaiMediaFormat]['mime'];

/** The studio's DNESKAI_MAX_IMAGE_PIXELS: a fetched picture has a bounded decode cost. */
export const DNESKAI_MEDIA_MAX_PIXELS = 64_000_000;
/** Pictures with a side under this are icons, avatars or tracking pixels, not source photographs. */
export const DNESKAI_MEDIA_MIN_SIDE = 300;

export class DneskaiMediaImageError extends Error {
  constructor(readonly code: 'media-excluded-format' | 'media-excluded-small' | 'media-undecodable' | 'media-too-many-pixels' | 'media-decoder-unavailable') { super(code); }
}

/** Same signatures as the studio's `sniffImageFormat`. */
export function sniffDneskaiImage(bytes: Uint8Array): DneskaiMediaFormat | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return 'jpeg';
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'png';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'webp';
  return null;
}

export interface DneskaiInspectedImage {
  sha256: string;
  format: DneskaiMediaFormat;
  mime: DneskaiMediaMime;
  ext: (typeof DNESKAI_MEDIA_FORMATS)[DneskaiMediaFormat]['ext'];
  /** Displayed size: EXIF orientation applied, as the studio measures it after `rotate()`. */
  width: number;
  height: number;
  bytes: number;
  /** 64-bit DCT perceptual hash as 16 hex digits. */
  phash: string;
  /** Credit, source, copyright and creator fields embedded in the file (IPTC, XMP); untrusted text, used only to name a photo agency. */
  embeddedCredits: string[];
}

const XMP_CREDIT_FIELDS = ['photoshop:Credit', 'photoshop:Source', 'dc:rights', 'dc:creator', 'Iptc4xmpCore:CreditLine', 'xmpRights:WebStatement', 'plus:LicensorName', 'plus:CopyrightOwnerName'];
/** IPTC IIM record 2 datasets: By-line (80), Credit (110), Source (115), Copyright Notice (116). */
const IPTC_CREDIT_DATASETS = new Set([80, 110, 115, 116]);
const MAX_EMBEDDED_CREDITS = 12;
const decodeXml = (value: string) => value.replace(/<[^>]*>/g, ' ').replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/&#(\d+);/g, (_, decimal: string) => String.fromCodePoint(Number(decimal))).replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const cleanCredit = (value: string) => value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);

/**
 * The credit fields a picture carries in its IPTC block (raw IIM records, also inside a Photoshop resource) and its
 * XMP packet. Pure; bounded in what it reads and returns. Publishers often strip these, so an empty list is normal.
 */
export function dneskaiEmbeddedCredits(metadata: { iptc?: Uint8Array; xmp?: Uint8Array }): string[] {
  const found: string[] = [];
  const iptc = metadata.iptc?.subarray(0, 65536);
  if (iptc) {
    for (let index = 0; index + 5 <= iptc.length; index += 1) {
      if (iptc[index] !== 0x1c || iptc[index + 1] !== 0x02) continue;
      const dataset = iptc[index + 2]!, length = (iptc[index + 3]! << 8) | iptc[index + 4]!;
      if (length & 0x8000 || index + 5 + length > iptc.length) continue;
      if (IPTC_CREDIT_DATASETS.has(dataset)) found.push(new TextDecoder('utf-8').decode(iptc.subarray(index + 5, index + 5 + length)));
      index += 4 + length;
    }
  }
  const xmp = metadata.xmp ? new TextDecoder('utf-8').decode(metadata.xmp.subarray(0, 262144)) : '';
  for (const field of xmp ? XMP_CREDIT_FIELDS : []) {
    const name = field.replace(':', '\\:').replace('.', '\\.');
    for (const match of xmp.matchAll(new RegExp(`${name}="([^"]{1,400})"`, 'g'))) found.push(decodeXml(match[1]!));
    for (const match of xmp.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]{0,2000}?)</${name}>`, 'g'))) found.push(decodeXml(match[1]!));
  }
  return [...new Set(found.map(cleanCredit).filter(Boolean))].slice(0, MAX_EMBEDDED_CREDITS);
}

const DCT_SIZE = 32;
const HASH_SIZE = 8;
const COSINES = Array.from({ length: HASH_SIZE }, (_, u) => Array.from({ length: DCT_SIZE }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * DCT_SIZE))));

/**
 * The classic pHash: a 32 × 32 grey thumbnail, its 8 × 8 lowest DCT frequencies, one bit per coefficient
 * above their median (the DC term excluded from the median). A resize, recompression or light crop of
 * the same photograph stays within a few bits; a different picture differs in about half of them.
 */
export function dctPerceptualHash(grey: Uint8Array): string {
  if (grey.length !== DCT_SIZE * DCT_SIZE) throw new Error('phash-input-invalid');
  const rows: number[][] = Array.from({ length: DCT_SIZE }, (_, y) => COSINES.map((cosine) => {
    let sum = 0;
    for (let x = 0; x < DCT_SIZE; x += 1) sum += grey[y * DCT_SIZE + x]! * cosine[x]!;
    return sum;
  }));
  const coefficients: number[] = [];
  for (let v = 0; v < HASH_SIZE; v += 1) {
    for (let u = 0; u < HASH_SIZE; u += 1) {
      let sum = 0;
      for (let y = 0; y < DCT_SIZE; y += 1) sum += rows[y]![u]! * COSINES[v]![y]!;
      coefficients.push(sum);
    }
  }
  const sorted = coefficients.slice(1).sort((left, right) => left - right);
  const median = (sorted[31]! + sorted[32]!) / 2;
  let hex = '';
  for (let index = 0; index < 64; index += 4) {
    let nibble = 0;
    for (let bit = 0; bit < 4; bit += 1) nibble = (nibble << 1) | (coefficients[index + bit]! > median ? 1 : 0);
    hex += nibble.toString(16);
  }
  return hex;
}

/** Bits that differ between two 16-hex-digit perceptual hashes. */
export function phashDistance(left: string, right: string): number {
  if (!/^[a-f0-9]{16}$/.test(left) || !/^[a-f0-9]{16}$/.test(right)) throw new Error('phash-invalid');
  let value = BigInt(`0x${left}`) ^ BigInt(`0x${right}`);
  let count = 0;
  while (value) { count += Number(value & BigInt(1)); value >>= BigInt(1); }
  return count;
}

/**
 * Reads one downloaded picture. Throws `DneskaiMediaImageError` for anything that must not be stored, and
 * `media-decoder-unavailable` when sharp itself does not load: that is the runtime's fault, not the picture's.
 */
export async function inspectDneskaiImage(input: Uint8Array): Promise<DneskaiInspectedImage> {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  const format = sniffDneskaiImage(bytes);
  if (!format) throw new DneskaiMediaImageError('media-excluded-format');
  let width: number, height: number, grey: Buffer, embeddedCredits: string[];
  try {
    const { default: sharp } = await import('sharp').catch(() => { throw new DneskaiMediaImageError('media-decoder-unavailable'); });
    const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
    if (!meta.width || !meta.height) throw new DneskaiMediaImageError('media-undecodable');
    if (meta.width * meta.height > DNESKAI_MEDIA_MAX_PIXELS) throw new DneskaiMediaImageError('media-too-many-pixels');
    // An animated WebP is a GIF in another container; the renderer draws stills.
    if ((meta.pages ?? 1) > 1) throw new DneskaiMediaImageError('media-excluded-format');
    embeddedCredits = dneskaiEmbeddedCredits({ iptc: meta.iptc, xmp: meta.xmp });
    const swapped = (meta.orientation ?? 1) >= 5;
    width = swapped ? meta.height : meta.width;
    height = swapped ? meta.width : meta.height;
    if (Math.min(width, height) < DNESKAI_MEDIA_MIN_SIDE) throw new DneskaiMediaImageError('media-excluded-small');
    grey = await sharp(bytes, { limitInputPixels: DNESKAI_MEDIA_MAX_PIXELS }).rotate().flatten({ background: '#ffffff' }).greyscale()
      .resize(DCT_SIZE, DCT_SIZE, { fit: 'fill' }).raw().toBuffer();
  } catch (error) {
    if (error instanceof DneskaiMediaImageError) throw error;
    throw new DneskaiMediaImageError('media-undecodable');
  }
  if (grey.length !== DCT_SIZE * DCT_SIZE) throw new DneskaiMediaImageError('media-undecodable');
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    format, mime: DNESKAI_MEDIA_FORMATS[format].mime, ext: DNESKAI_MEDIA_FORMATS[format].ext,
    width, height, bytes: bytes.length, phash: dctPerceptualHash(grey), embeddedCredits,
  };
}
