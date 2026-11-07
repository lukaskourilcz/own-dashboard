import type { BrandTokens, ImageCrop } from "./schema.js";
import { CarouselPayloadSchema, CarouselTemplateSchema, carouselCanvas } from "./schema.js";
import { dressBrand, kitStyleFor } from "./kit-style.js";
import type { CarouselRenderInput } from "./renderer.js";

/*
 * What happens to a photograph between the caller's bytes and the SVG: the crop a payload asks
 * for, then the treatment a template asks for. Both in sharp, both before embedding, and both
 * skipped entirely when nothing asks for them, which is what keeps every v1 hash where it was.
 */

/**
 * How a photograph is cut to its frame: which region of the source, and the size it is drawn at.
 *
 * Done in sharp before the bytes reach the SVG rather than with `preserveAspectRatio`, which can
 * only ever centre. The region has the frame's own shape for a `cover` fit, so the SVG's `slice`
 * has nothing left to cut, and the source's shape for `contain`, so nothing is cut at all. Zoom
 * shrinks the region around the focal point; the region is then slid back inside the picture, so
 * a focal point near an edge keeps the edge rather than drawing past it.
 *
 * Pure arithmetic on integers, so the same picture, crop and frame cut the same pixels everywhere.
 */
export interface CropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
  /** The pixel size the region is resampled to: the frame's, or the contained picture's. */
  outWidth: number;
  outHeight: number;
}

export function cropRegion(
  source: { width: number; height: number },
  crop: Pick<ImageCrop, "focal" | "zoom">,
  frame: { width: number; height: number },
  fit: "cover" | "contain"
): CropRegion {
  const frameWidth = Math.max(1, Math.round(frame.width));
  const frameHeight = Math.max(1, Math.round(frame.height));
  const zoom = crop.zoom ?? 1;
  let regionWidth = source.width;
  let regionHeight = source.height;
  if (fit === "cover") {
    const aspect = frameWidth / frameHeight;
    regionWidth = Math.min(source.width, source.height * aspect);
    regionHeight = regionWidth / aspect;
  }
  const width = Math.min(source.width, Math.max(1, Math.round(regionWidth / zoom)));
  const height = Math.min(source.height, Math.max(1, Math.round(regionHeight / zoom)));
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  const left = clamp(Math.round(crop.focal.x * source.width - width / 2), source.width - width);
  const top = clamp(Math.round(crop.focal.y * source.height - height / 2), source.height - height);
  if (fit === "cover") return { left, top, width, height, outWidth: frameWidth, outHeight: frameHeight };
  const scale = Math.min(frameWidth / width, frameHeight / height);
  return {
    left,
    top,
    width,
    height,
    outWidth: Math.max(1, Math.round(width * scale)),
    outHeight: Math.max(1, Math.round(height * scale))
  };
}

/** Cut and resample one photograph for its frame, as PNG. */
export async function cropImage(
  bytes: Buffer,
  crop: Pick<ImageCrop, "focal" | "zoom">,
  frame: { width: number; height: number },
  fit: "cover" | "contain"
): Promise<Buffer> {
  const { default: sharp } = await import("sharp");
  const { width, height } = await sharp(bytes).metadata();
  if (!width || !height) throw new Error("The photograph has no pixel size to crop");
  const region = cropRegion({ width, height }, crop, frame, fit);
  return sharp(bytes)
    .extract({ left: region.left, top: region.top, width: region.width, height: region.height })
    .resize(region.outWidth, region.outHeight, { fit: "fill" })
    .png()
    .toBuffer();
}

function tokenValue(brand: BrandTokens, name: string): string {
  const value = brand.colors[name];
  if (!value) throw new Error(`Brand ${brand.id} does not define color token ${name}`);
  return value.toLowerCase();
}

/**
 * The photograph, as the template asked for it.
 *
 * Done with sharp before the bytes reach the SVG, never as an SVG filter: librsvg's filter
 * support is the same quiet-failure surface as its WebP handling, and a treatment that silently
 * does nothing is worse than one that is not offered. `duotone` multiplies the greyscale by the
 * slide's accent, which is what makes it read as the venture's own colour rather than as a filter.
 *
 * Returns the input untouched when nothing asks for a treatment, so a v1 template's bytes — and
 * therefore its hashes — are exactly what they were.
 */
export async function treatImage(
  bytes: Buffer,
  treatment: "none" | "mono" | "duotone",
  accentHex: string
): Promise<Buffer> {
  if (treatment === "none") return bytes;
  const { default: sharp } = await import("sharp");
  const grey = sharp(bytes).greyscale();
  if (treatment === "mono") return grey.png().toBuffer();
  const [red, green, blue] = [1, 3, 5].map((offset) => Number.parseInt(accentHex.slice(offset, offset + 2), 16));
  // Materialize RGB first: greyscale temporarily has one band inside a sharp pipeline,
  // while toColourspace is an output conversion and runs after linear.
  const rgb = await grey.toColourspace("srgb").png().toBuffer();
  return sharp(rgb)
    .linear([red! / 255, green! / 255, blue! / 255], [0, 0, 0])
    .png()
    .toBuffer();
}

/**
 * Bytes this module has already cropped or treated.
 *
 * `prepareCarouselImages` is exported so a caller can draw the SVG itself, and `renderCarouselPng`
 * prepares too. Without this a caller that prepared and then rendered would crop a crop — the
 * focal point read against an already-cut picture — or tint a duotone twice. Keyed by the buffer
 * object, because the bytes are only "prepared" for the render that produced them, and a cut
 * remembers which crop and frame it was made for: bytes cut for one crop are refused for another
 * instead of being drawn as if they were it.
 */
const CROPPED = new WeakMap<Buffer, string>();
const TREATED = new WeakSet<Buffer>();

function marked(set: WeakSet<Buffer>, bytes: Buffer): Buffer {
  set.add(bytes);
  return bytes;
}

export function isPrepared(bytes: Buffer): boolean {
  return CROPPED.has(bytes) || TREATED.has(bytes);
}

/** The crop, fit and frame size a slot's cut is made for: equal keys cut equal pixels. */
function cutFor(input: Pick<CarouselRenderInput, "template" | "format">, slot: string, crop: ImageCrop) {
  const template = CarouselTemplateSchema.parse(input.template);
  const canvas = template.formats[carouselCanvas(input.format)];
  const layer = template.slides.flatMap((slide) => slide.layers).find((candidate) => candidate.type === "image" && candidate.slot === slot);
  if (layer?.type !== "image") throw new Error(`Carousel payload crops image slot ${slot}, which the template does not carry`);
  const frame = { width: layer.width * canvas.width, height: layer.height * canvas.height };
  const fit = crop.fit ?? layer.fit;
  const key = JSON.stringify([crop.focal.x, crop.focal.y, crop.zoom ?? 1, fit, Math.round(frame.width), Math.round(frame.height)]);
  return { frame, fit, key };
}

/** Whether `bytes` are the cut this render's crop of `slot` asks for, made by this module. */
export function isCutFor(input: Pick<CarouselRenderInput, "template" | "format">, slot: string, crop: ImageCrop, bytes: Buffer): boolean {
  const made = CROPPED.get(bytes);
  return made !== undefined && made === cutFor(input, slot, crop).key;
}

/**
 * Each cropped slot cut for the first layer that draws it.
 *
 * Per slot rather than per layer, because `images` is keyed by slot: a reprise of the same
 * photograph shows the same cut through its own window, centred, as an uncropped reprise always has.
 */
async function croppedImages(input: CarouselRenderInput, images: Readonly<Record<string, Buffer>>): Promise<Readonly<Record<string, Buffer>>> {
  const crops = CarouselPayloadSchema.parse(input.payload).images;
  if (!crops || Object.keys(crops).length === 0) return images;
  const cut: Record<string, Buffer> = { ...images };
  for (const [slot, crop] of Object.entries(crops)) {
    const bytes = images[slot];
    if (!bytes) continue;
    const target = cutFor(input, slot, crop);
    const made = CROPPED.get(bytes);
    if (made === target.key) continue;
    if (made !== undefined || TREATED.has(bytes)) {
      throw new Error(`Image slot ${slot} holds bytes already prepared for another crop or frame; pass the original photograph`);
    }
    const bytesCut = await cropImage(bytes, crop, target.frame, target.fit);
    CROPPED.set(bytesCut, target.key);
    cut[slot] = bytesCut;
  }
  return cut;
}

/**
 * The photographs as the template and payload ask for them: cropped, then treated.
 *
 * Returns the caller's own record untouched when nothing is cropped or treated, so a v1 template's
 * bytes — and therefore its hashes — are exactly what they were. Idempotent: bytes it has already
 * produced pass through a second time unchanged.
 */
export async function prepareCarouselImages(input: CarouselRenderInput): Promise<CarouselRenderInput["images"]> {
  if (!input.images) return input.images;
  const cut = await croppedImages(input, input.images);
  return treatedImages({ ...input, images: cut });
}

async function treatedImages(input: CarouselRenderInput): Promise<CarouselRenderInput["images"]> {
  const images = input.images;
  if (!images) return images;
  const wanted = new Map<string, "mono" | "duotone">();
  for (const slide of input.template.slides) {
    const variant = input.payload.variant
      ? slide.variants.find((candidate) => candidate.id === input.payload.variant)
      : undefined;
    for (const layer of slide.layers) {
      if (layer.type !== "image" || layer.treatment === "none") continue;
      // One slot may appear twice — a reprise — and both appearances share the treated bytes.
      wanted.set(`${layer.slot}\0${variant?.accentToken ?? "accent"}`, layer.treatment);
    }
  }
  if (wanted.size === 0) return images;
  // The kit's accent, not the tokens a caller passed: a duotone is drawn in the brand's colour.
  const style = kitStyleFor(input.brand);
  const brand = style ? dressBrand(input.brand, style) : input.brand;
  const treated: Record<string, Buffer> = { ...images };
  for (const [key, treatment] of wanted) {
    const [slot, accentToken] = key.split("\0") as [string, string];
    const source = images[slot];
    if (!source) continue;
    if (TREATED.has(source)) continue;
    const bytes = marked(TREATED, await treatImage(source, treatment, tokenValue(brand, accentToken)));
    // A treated cut is still that cut, so preparing it again passes it through.
    const made = CROPPED.get(source);
    if (made !== undefined) CROPPED.set(bytes, made);
    treated[slot] = bytes;
  }
  return treated;
}
