import { dneskaiKit } from "./dneskai-kits/registry.js";
import { DNESKAI_DEFAULT_KIT, DNESKAI_VARIANTS, DNESKAI_INK_VARIANT, DNESKAI_QUOTE_MARK, type DneskaiKitId, type DneskaiSlideType, type DneskaiVariant } from "./dneskai-kits/contract.js";
import type { DneskaiKit } from "./dneskai-kits/kit.js";
export { DNESKAI_KITS, dneskaiKit } from "./dneskai-kits/registry.js";
export { DNESKAI_KIT_IDS, DNESKAI_DEFAULT_KIT, DNESKAI_SLIDE_TYPES, DNESKAI_VARIANTS, DNESKAI_TEMPLATE_ROLES, dneskaiRoleOf, DNESKAI_TEXT_FIELDS, DNESKAI_CODE_OWNED_SLOTS, DNESKAI_TEXT_LIMITS, dneskaiImageSlots, DNESKAI_OPTIONAL_IMAGE_SLOTS, DNESKAI_TEMPLATE_VARIANTS } from "./dneskai-kits/contract.js";
export type { DneskaiKitId, DneskaiSlideType, DneskaiVariant, DneskaiTemplateRole, DneskaiTextField } from "./dneskai-kits/contract.js";
export type { DneskaiKit, DneskaiKitTemplate, DneskaiFieldFace } from "./dneskai-kits/kit.js";
export type { DneskaiFlow, DneskaiLayoutMetrics } from "./dneskai-layout.js";
import { createHash } from "node:crypto";
import { CONNECTOR_MAX_SLIDES, MASTER_CANVAS, MASTER_FORMAT } from "./canvas.js";
import { layoutDneskaiSlide, type DneskaiLaidPicture } from "./dneskai-layout.js";
import { DNESKAI_MAX_SOURCES, DNESKAI_MAX_THUMBNAILS, dneskaiSourceSlot } from "./dneskai-photo.js";
import { cropRegion } from "./images.js";
import { CAROUSEL_BRANDS } from "./library.js";
import { carouselTextFits, renderCarouselSlidePng } from "./renderer.js";
import { ImageCropSchema, type CarouselPayload, type CarouselTemplate, type ImageCrop } from "./schema.js";

/**
 * One DNESKAi Instagram slide, rendered from words and photographs (quorum#603, own-dashboard#110).
 *
 * The API OwnDashboard calls. It picks the photo-kit template for the slide type, writes the
 * strings code owns (the sources slide's title and its disclosure, a quotation mark), decodes and crops
 * the photographs, lays the slide out for what it holds (`dneskai-layout.ts`: frames shrink to
 * the words and pictures they carry and the height left over is set around them on purpose), and
 * renders through the same engine and gates as every other Design Lab slide.
 *
 * It refuses rather than degrades. A missing required photograph, a full-bleed photograph under
 * `DNESKAI_BLEED_MIN_SHORT_SIDE` or cropped past `DNESKAI_BLEED_MAX_UPSCALE`, bytes that do not
 * match the asset hash a crop was set on and an image the slide has no place for each return the
 * problem and no PNG — never a slide without its picture, never a silent upscale. Words that would
 * be cut still render, and every cut slot is in `truncatedSlots` and in `problems`, so nothing is
 * shortened without saying so; a picture stretched short of refusal is reported the same way.
 *
 * Deterministic: the same input renders the same PNG bytes, and the returned `payload` is the
 * exact record the slide was drawn from — the words, the variant and each photograph's crop with
 * the sha256 of the bytes it was set on — so an approval can hash what was seen.
 */



/** A photograph drawn to every edge needs this many pixels on its shorter side (report §5.3). */
export const DNESKAI_BLEED_MIN_SHORT_SIDE = 900;

/**
 * The most a full-bleed crop may stretch the pixels it cuts; past it the slide is refused.
 *
 * The farthest a picture that passes the 900 px rule is ever stretched at zoom 1: a 16:9 hero
 * 900 px tall gives a 720 × 900 region, drawn to the 1350 px edge. A zoom, or a crop that cuts
 * less of the picture, may not stretch it further; that is refused like a smaller original.
 */
export const DNESKAI_BLEED_MAX_UPSCALE = MASTER_CANVAS.height / DNESKAI_BLEED_MIN_SHORT_SIDE;

/**
 * A full-bleed crop stretched past this, but within `DNESKAI_BLEED_MAX_UPSCALE`, renders and is
 * reported as `image-upscaled`: 900 px across the 1080 px width.
 */
export const DNESKAI_BLEED_SOFT_UPSCALE = MASTER_CANVAS.width / DNESKAI_BLEED_MIN_SHORT_SIDE;

/** The stored file formats a slide decodes. Anything else, SVG included, is refused unread. */
export const DNESKAI_IMAGE_FORMATS = ["jpeg", "png", "webp"] as const;

/** Which of `DNESKAI_IMAGE_FORMATS` a file is, by its signature, or null for anything else. */
export function sniffImageFormat(bytes: Uint8Array): (typeof DNESKAI_IMAGE_FORMATS)[number] | null {
  const at = (offset: number, ...values: number[]) => values.every((value, index) => bytes[offset + index] === value);
  if (at(0, 0xff, 0xd8, 0xff)) return "jpeg";
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "png";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "webp";
  return null;
}

/** The largest file a slide takes, in bytes. */
export const DNESKAI_MAX_IMAGE_BYTES = 32 * 1024 * 1024;

/** The most pixels a slide decodes from one file, so a fetched picture has a bounded cost. */
export const DNESKAI_MAX_IMAGE_PIXELS = 64_000_000;

/** A framed photograph resampled past this factor is reported, not refused. */
export const DNESKAI_FRAME_MAX_UPSCALE = 1.5;

export interface DneskaiImageInput {
  /** `image-1`, `image-2`, … in the order the slide type places them. */
  slot: string;
  /** The stored file: JPEG, PNG or WebP, at most 32 MiB and 64 megapixels. Decoded and oriented here. */
  bytes: Buffer | Uint8Array;
  /**
   * Where to keep the picture in view. Absent: centred, at zoom 1, in the template's own fit.
   * A crop record from an earlier `payload.images` may be passed back as it is; its
   * `assetSha256`, when present, must be the hash of `bytes`. The returned payload always records
   * the hash of `bytes`.
   */
  crop?: ImageCrop;
  /** The sha256 the caller stored the asset under. When given, the bytes must hash to it. */
  assetSha256?: string;
}

export interface DneskaiSlideInput {
  /** Absent preserves the approved editorial kit. */
  kit?: DneskaiKitId;
  type: DneskaiSlideType;
  /** `statement`: `accent` (default) or `ink`. `single`: `photo` (default) or `type`. */
  variant?: DneskaiVariant;
  headline?: string;
  body?: string;
  /** Set only on the split slides. Ignored elsewhere since the owner's decision of 22 October 2026. */
  kicker?: string;
  /** Accepted and ignored: no slide shows a picture credit; it belongs in the Instagram caption. */
  credit?: string;
  /** The sources slide's lines, one source each, at most `DNESKAI_MAX_SOURCES`. */
  sources?: readonly string[];
  images?: readonly DneskaiImageInput[];
  /** The slide's place in the carousel; a single post is `{ 0, 1 }`. No slide prints it. */
  position: { index: number; count: number };
  locale?: "cs" | "en";
}

export type DneskaiProblemCode =
  | "kit-invalid"
  | "position-invalid"
  | "variant-invalid"
  | "text-missing"
  | "text-clipped"
  | "sources-missing"
  | "sources-too-many"
  | "image-missing"
  | "image-unexpected"
  | "image-duplicate"
  | "image-undecodable"
  | "image-unsupported"
  | "image-hash-mismatch"
  | "image-low-resolution"
  | "image-upscaled"
  | "crop-invalid";

export interface DneskaiSlideProblem {
  code: DneskaiProblemCode;
  /** A blocking problem means no PNG. A non-blocking one renders and is reported beside it. */
  blocking: boolean;
  /** The input field or image slot it is about, when there is one. */
  field: string | null;
  message: string;
}

export interface DneskaiSlideResult {
  kit: DneskaiKitId | null;
  status: "rendered" | "refused";
  png: Buffer | null;
  pngHash: string | null;
  svgHash: string | null;
  /** Text slots that did not fit whole and were cut, by slot name. */
  truncatedSlots: string[];
  problems: DneskaiSlideProblem[];
  /** Which template drew it, null when the slide type itself could not be resolved. */
  template: { id: string; version: string } | null;
  /** The exact payload the slide was (or would have been) drawn from. */
  payload: CarouselPayload | null;
}

const FIXED_STRINGS = {
  cs: {
    title: "Zdroje",
    imagesLabel: "Použité obrázky",
    disclosure: "Text připravil jazykový model z uvedených zdrojů. Výběr a schválení: redakce DNESKAi."
  },
  en: {
    title: "Sources",
    imagesLabel: "Images used",
    disclosure: "A language model drafted the text from the sources listed. Selected and approved by the DNESKAi editors."
  }
} as const;

/**
 * The sources that say something, each with its place in the caller's list.
 *
 * A blank line is not a source: it is neither counted nor drawn as an empty row, and the lines
 * after it close up. The original index stays, so a cut line names the entry the caller wrote.
 */
function sourceLines(input: DneskaiSlideInput): Array<{ text: string; index: number }> {
  return (input.sources ?? []).flatMap((line, index) => line.trim() ? [{ text: line.trim(), index }] : []);
}

/** Which input field a text slot is filled from, so a cut slot names what to shorten. */
function fieldOf(slot: string, input: DneskaiSlideInput): string {
  if (!slot.startsWith("source-")) return slot;
  const line = sourceLines(input)[Number(slot.slice("source-".length)) - 1];
  return `sources[${line?.index ?? Number(slot.slice("source-".length)) - 1}]`;
}

const problem = (code: DneskaiProblemCode, blocking: boolean, field: string | null, message: string): DneskaiSlideProblem => ({ code, blocking, field, message });

/** The template a slide type and variant resolve to, or the problem that stops it. */
function resolveTemplate(input: DneskaiSlideInput, kit: DneskaiKit): CarouselTemplate | DneskaiSlideProblem {
  const allowed = DNESKAI_VARIANTS[input.type];
  if (!allowed) return problem("variant-invalid", true, "type", `There is no DNESKAi slide type ${String(input.type)}.`);
  if (input.variant !== undefined && !allowed.includes(input.variant)) {
    return problem("variant-invalid", true, "variant", `A ${input.type} slide has ${allowed.length ? `the variants ${allowed.join(", ")}` : "no variants"}, not ${input.variant}.`);
  }
  return kit.resolve(input.type, input.variant, (input.images??[]).map(image=>image.slot));
}

/** Every image layer of a single-slide template, by slot. */
function imageLayers(template: CarouselTemplate) {
  return new Map(template.slides[0]!.layers.flatMap((layer) => layer.type === "image" ? [[layer.slot, layer] as const] : []));
}

function isBleed(layer: { x: number; y: number; width: number; height: number }): boolean {
  return layer.x <= 0 && layer.y <= 0 && layer.width >= 1 && layer.height >= 1;
}

function strings(input: DneskaiSlideInput, template: CarouselTemplate): Record<string, string> {
  const fixed = FIXED_STRINGS[input.locale ?? "cs"];
  const all: Record<string, string> = {
    headline: input.headline?.trim() ?? "",
    body: input.body?.trim() ?? "",
    kicker: input.kicker?.trim() ?? "",
    credit: input.credit?.trim() ?? "",
    title: fixed.title,
    "images-label": fixed.imagesLabel,
    disclosure: fixed.disclosure,
    "quote-mark": DNESKAI_QUOTE_MARK,
    ...Object.fromEntries(Array.from({ length: DNESKAI_MAX_SOURCES }, (_, index) => [dneskaiSourceSlot(index), sourceLines(input)[index]?.text ?? ""]))
  };
  return Object.fromEntries(template.requiredSlots.map((slot) => [slot, all[slot] ?? ""]));
}

interface Inspection {
  kit: DneskaiKit | null;
  problems: DneskaiSlideProblem[];
  template: CarouselTemplate | null;
  payload: CarouselPayload | null;
  images: Record<string, Buffer>;
}

async function inspect(input: DneskaiSlideInput): Promise<Inspection> {
  const problems: DneskaiSlideProblem[] = [];
  const { index, count } = input.position;
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || count > CONNECTOR_MAX_SLIDES || index < 0 || index >= count) {
    problems.push(problem("position-invalid", true, "position", `Slide ${index + 1} of ${count} is not a place in a carousel of 1 to ${CONNECTOR_MAX_SLIDES} slides.`));
  }
  const kit=dneskaiKit(input.kit??DNESKAI_DEFAULT_KIT);
  if(!kit)return {kit:null,problems:[...problems,problem("kit-invalid",true,"kit",`Unknown DNESKAi kit ${String(input.kit)}.`)],template:null,payload:null,images:{}};
  const resolved = resolveTemplate(input, kit);
  if (!("schemaVersion" in resolved)) return { kit, problems: [...problems, resolved], template: null, payload: null, images: {} };
  const template = resolved;

  if (input.type === "sources") {
    const lines = sourceLines(input);
    if (lines.length === 0) problems.push(problem("sources-missing", true, "sources", "A sources slide names at least one source."));
    if (lines.length > DNESKAI_MAX_SOURCES) {
      problems.push(problem("sources-too-many", true, "sources", `A sources slide carries ${DNESKAI_MAX_SOURCES} sources; this one has ${lines.length}.`));
    }
    if ((input.images?.length ?? 0) > DNESKAI_MAX_THUMBNAILS) {
      problems.push(problem("image-unexpected", true, "images", `A sources slide shows ${DNESKAI_MAX_THUMBNAILS} thumbnails; this one was given ${input.images!.length}.`));
    }
  } else if (!input.headline?.trim()) {
    problems.push(problem("text-missing", true, "headline", `A ${input.type} slide needs a headline.`));
  }

  const layers = imageLayers(template);
  const seen = new Set<string>();
  const images: Record<string, Buffer> = {};
  const crops: Record<string, ImageCrop> = {};
  const pictures: Record<string, DneskaiLaidPicture> = {};
  // One list per given image, so a picture's resolution problems, found once the slide is laid
  // out, are reported beside its decoding problems in the order the images were given.
  const perImage: DneskaiSlideProblem[][] = [];
  const { default: sharp } = await import("sharp");
  for (const image of input.images ?? []) {
    const found: DneskaiSlideProblem[] = [];
    perImage.push(found);
    if (seen.has(image.slot)) {
      found.push(problem("image-duplicate", true, image.slot, `Image slot ${image.slot} was given twice.`));
      continue;
    }
    seen.add(image.slot);
    const layer = layers.get(image.slot);
    if (!layer) {
      found.push(problem("image-unexpected", true, image.slot, `A ${input.type} slide (${template.id}) has no place for ${image.slot}; it holds ${[...layers.keys()].join(", ") || "no images"}.`));
      continue;
    }
    const bytes = Buffer.from(image.bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (image.assetSha256 !== undefined && image.assetSha256 !== sha256) {
      found.push(problem("image-hash-mismatch", true, image.slot, `The bytes for ${image.slot} hash to ${sha256}, not the asset ${image.assetSha256}.`));
      continue;
    }
    // A crop handed back from an earlier payload names the asset it was set on. Other bytes mean
    // another picture, so it is refused rather than recorded against bytes it never saw.
    const cropAsset = image.crop?.assetSha256;
    if (cropAsset !== undefined && cropAsset !== sha256) {
      found.push(problem("image-hash-mismatch", true, image.slot,
        `The crop for ${image.slot} was set on the asset ${cropAsset}, but these bytes hash to ${sha256}. Drop the crop's assetSha256 to reuse it on another picture.`));
      continue;
    }
    // The computed hash goes last, so the record always names the bytes that were drawn.
    const crop = ImageCropSchema.safeParse({ focal: { x: 0.5, y: 0.5 }, ...image.crop, assetSha256: sha256 });
    if (!crop.success) {
      found.push(problem("crop-invalid", true, image.slot, `The crop for ${image.slot} is not valid: ${crop.error.issues.map((issue) => issue.message).join("; ")}.`));
      continue;
    }
    if (bytes.length > DNESKAI_MAX_IMAGE_BYTES) {
      found.push(problem("image-unsupported", true, image.slot,
        `The file for ${image.slot} is ${bytes.length} bytes; this renderer takes at most ${DNESKAI_MAX_IMAGE_BYTES}.`));
      continue;
    }
    let decoded: Buffer;
    let size: { width: number; height: number };
    try {
      // The format is read from the file's signature before sharp sees it: sharp would also open
      // SVG through librsvg, GIF, TIFF and HEIF, and a fetched third-party file must not reach
      // those decoders. libvips picks its loader from the same signature.
      if (!sniffImageFormat(bytes)) {
        found.push(problem("image-unsupported", true, image.slot,
          `The file for ${image.slot} is not ${DNESKAI_IMAGE_FORMATS.join(", ")}; this renderer takes no other format.`));
        continue;
      }
      const meta = await sharp(bytes, { limitInputPixels: false }).metadata();
      if ((meta.width ?? 0) * (meta.height ?? 0) > DNESKAI_MAX_IMAGE_PIXELS) {
        found.push(problem("image-unsupported", true, image.slot,
          `${image.slot} is ${meta.width} × ${meta.height} px; this renderer decodes at most ${DNESKAI_MAX_IMAGE_PIXELS / 1_000_000} megapixels.`));
        continue;
      }
      // rotate() with no angle applies the file's own orientation, so a phone photograph stands up.
      const { data, info } = await sharp(bytes, { limitInputPixels: DNESKAI_MAX_IMAGE_PIXELS }).rotate().png().toBuffer({ resolveWithObject: true });
      decoded = data;
      size = { width: info.width, height: info.height };
    } catch {
      found.push(problem("image-undecodable", true, image.slot, `The bytes for ${image.slot} are not an image this renderer can decode.`));
      continue;
    }
    // Recorded even when the picture is refused below: the crop is the editor's and stays valid
    // for a larger original of the same subject, and the payload says what would have been drawn.
    images[image.slot] = decoded;
    crops[image.slot] = crop.data;
    pictures[image.slot] = { ...size, crop: crop.data, focalGiven: image.crop?.focal !== undefined };
  }
  const missing: DneskaiSlideProblem[] = [];
  for (const [slot, layer] of layers) {
    if (!layer.optional && !seen.has(slot)) {
      missing.push(problem("image-missing", true, slot, `A ${input.type} slide (${template.id}) needs a photograph in ${slot}.`));
    }
  }

  const payload: CarouselPayload = {
    locale: input.locale ?? "cs",
    strings: strings(input, template),
    ...(input.type === "statement" && input.variant === "ink" ? { variant: DNESKAI_INK_VARIANT } : {}),
    ...(Object.keys(crops).length ? { images: crops } : {})
  };
  // The words fitted in the template's declared frames: what would be cut, found without the
  // photographs so it is reported even when an image problem stops the render, and the lines
  // the layout stacks.
  const fits = carouselTextFits({ template, payload, brand: CAROUSEL_BRANDS["caught-up"], format: MASTER_FORMAT, look: kit.look });
  const clipped: DneskaiSlideProblem[] = [];
  for (const fit of fits) {
    if (fit.fitted.truncated && payload.strings[fit.slot]) {
      const field = fieldOf(fit.slot, input);
      clipped.push(problem("text-clipped", false, field, `The ${field} does not fit ${fit.slot} whole and would be cut; shorten it.`));
    }
  }
  const laid = layoutDneskaiSlide({
    flow: kit.flows.get(template.id)!, metrics: kit.metrics,
    template,
    text: Object.fromEntries(fits.map((fit) => [fit.slot, { lines: fit.fitted.lines.length, fontSize: fit.fitted.fontSize, capHeight: fit.face.capHeight / 1000 }])),
    pictures
  });

  // Measured on the region the crop actually cuts in the frame the picture is laid out in, not on
  // the file: a zoom or a frame of another shape draws fewer of the picture's pixels, and those are
  // the ones stretched to the frame.
  const laidLayers = imageLayers(laid);
  (input.images ?? []).forEach((image, index) => {
    const picture = pictures[image.slot];
    const layer = laidLayers.get(image.slot);
    // Only the given image a slot was decoded from: a duplicate was refused above.
    if (!picture || !layer || (input.images ?? []).findIndex((other) => other.slot === image.slot) !== index) return;
    const frame = { width: layer.width * MASTER_CANVAS.width, height: layer.height * MASTER_CANVAS.height };
    const region = cropRegion(picture, picture.crop, frame, picture.crop.fit ?? layer.fit);
    const upscale = Math.max(region.outWidth / region.width, region.outHeight / region.height);
    const drawn = `${image.slot} is ${picture.width} × ${picture.height} px and this crop draws ${region.width} × ${region.height} px of it at ${upscale.toFixed(2)}×`;
    const found = perImage[index]!;
    if (isBleed(layer)) {
      const shorter = Math.min(picture.width, picture.height);
      if (shorter < DNESKAI_BLEED_MIN_SHORT_SIDE || upscale > DNESKAI_BLEED_MAX_UPSCALE) {
        found.push(problem("image-low-resolution", true, image.slot,
          `${drawn}; a photograph across the whole slide needs ${DNESKAI_BLEED_MIN_SHORT_SIDE} px on its shorter side and at most ${DNESKAI_BLEED_MAX_UPSCALE}× once cropped. Use a larger original, zoom out or use a framed slide.`));
      } else if (upscale > DNESKAI_BLEED_SOFT_UPSCALE) {
        found.push(problem("image-upscaled", false, image.slot, `${drawn} across the whole slide and may look soft.`));
      }
    } else if (upscale > DNESKAI_FRAME_MAX_UPSCALE) {
      found.push(problem("image-upscaled", false, image.slot, `${drawn} in this frame and may look soft.`));
    }
  });
  return { kit, problems: [...problems, ...perImage.flat(), ...missing, ...clipped], template: laid, payload, images };
}

/** Every problem the slide has, without rendering it. */
export async function validateDneskaiSlide(input: DneskaiSlideInput): Promise<DneskaiSlideProblem[]> {
  return (await inspect(input)).problems;
}

/** Render one slide, or refuse with the problems that stop it. */
export async function renderDneskaiSlide(input: DneskaiSlideInput): Promise<DneskaiSlideResult> {
  const { kit, problems, template, payload, images } = await inspect(input);
  const reference = template ? { id: template.id, version: template.version } : null;
  if (!template || !payload || problems.some((entry) => entry.blocking)) {
    return { kit:kit?.id??null, status: "refused", png: null, pngHash: null, svgHash: null, truncatedSlots: [], problems, template: reference, payload };
  }
  const rendered = await renderCarouselSlidePng({
    template,
    payload,
    brand: CAROUSEL_BRANDS["caught-up"],
    look: kit!.look,
    format: MASTER_FORMAT,
    images,
    deck: input.position,
    index: 0
  });
  if (!rendered) throw new Error(`Template ${template.id} has no slide to render`);
  return {
    kit: kit!.id,
    status: "rendered",
    png: rendered.png,
    pngHash: rendered.pngHash,
    svgHash: rendered.svgHash,
    truncatedSlots: rendered.truncatedSlots,
    problems,
    template: reference,
    payload
  };
}
