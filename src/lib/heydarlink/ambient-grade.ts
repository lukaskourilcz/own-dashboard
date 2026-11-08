import 'server-only';
import sharp, { type OverlayOptions } from "sharp";
import { AMBIENT_GATE, AMBIENT_SIZES, type AmbientAspect, type AmbientGrade } from "./ambient-config";

export class CropRefused extends Error {}

/**
 * The shared finishing pass: every ambient frame leaves through here, whatever rendered it.
 *
 * each renderer leaves their own sharpening and compression fingerprint, and a
 * carousel that mixes them reads as three cameras. One curve, one white balance shift, one grain
 * layer, one vignette, one resampler and one encoder flatten that. The values per persona are the
 * look the Foxy frames already carry (research section 3.6.5), so the ambient slide sits beside
 * her cover without a seam.
 *
 * A source in the wrong aspect is cropped only up to `maxCropFraction` and refused beyond it.
 * Nothing here has a person in it, so a centre crop cannot cut a head; the cap exists so that a
 * square render is never stretched into a story and called native.
 */
export async function gradeAmbientFrame(input: {
  source: Uint8Array;
  aspect: AmbientAspect;
  grade: AmbientGrade;
  /** Fixed per frame so a regrade of the same bytes is byte-identical. */
  noiseSeed: number;
}): Promise<Buffer> {
  const { width, height } = AMBIENT_SIZES[input.aspect];
  const meta = await sharp(input.source).metadata();
  if (!meta.width || !meta.height) throw new CropRefused("source has no dimensions");
  const target = width / height;
  const actual = meta.width / meta.height;
  const crop = actual > target ? 1 - target / actual : 1 - actual / target;
  if (crop > AMBIENT_GATE.maxCropFraction + 1e-6) {
    throw new CropRefused(`source ${meta.width}x${meta.height} needs a ${(crop * 100).toFixed(1)}% crop`);
  }

  const { contrast, lift, warmth, saturation, grain, vignette } = input.grade;
  // Contrast pivots on mid-grey so it never shifts exposure; lift raises or crushes the blacks.
  const offset = 128 * (1 - contrast) + lift;
  const shift = warmth * 0.06;
  const base = await sharp(input.source)
    .rotate()
    .resize(width, height, { fit: "cover", position: "centre", kernel: "lanczos3" })
    .toColourspace("srgb")
    .removeAlpha()
    .linear([contrast, contrast, contrast], [offset, offset, offset])
    .recomb([
      [1 + shift, 0, 0],
      [0, 1, 0],
      [0, 0, 1 - shift]
    ])
    .modulate({ saturation })
    .raw()
    .toBuffer();

  const layers: OverlayOptions[] = [];
  if (grain > 0) layers.push({ input: grainLayer(width, height, grain, input.noiseSeed), raw: { width, height, channels: 1 }, blend: "soft-light" });
  if (vignette > 0) layers.push({ input: Buffer.from(vignetteSvg(width, height, vignette)), blend: "multiply" });

  return sharp(base, { raw: { width, height, channels: 3 } })
    .composite(layers)
    .jpeg({ quality: 92, chromaSubsampling: "4:2:0", mozjpeg: false })
    .toBuffer();
}

/** Monochrome grain around mid-grey; soft-light leaves mid-grey pixels untouched. */
export function grainLayer(width: number, height: number, amount: number, seed: number): Buffer {
  const layer = Buffer.alloc(width * height);
  let state = seed >>> 0 || 1;
  const amplitude = amount * 255 * 4;
  for (let i = 0; i < layer.length; i++) {
    // xorshift32: deterministic, fast, and good enough for film grain.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    const unit = (state >>> 0) / 0xffffffff - 0.5;
    layer[i] = Math.max(0, Math.min(255, Math.round(128 + unit * amplitude)));
  }
  return layer;
}

function vignetteSvg(width: number, height: number, amount: number): string {
  const edge = Math.round(255 * (1 - amount * 4));
  const shade = `rgb(${edge},${edge},${edge})`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
<defs><radialGradient id="v" cx="50%" cy="50%" r="72%">
<stop offset="55%" stop-color="white"/><stop offset="100%" stop-color="${shade}"/>
</radialGradient></defs><rect width="100%" height="100%" fill="url(#v)"/></svg>`;
}
