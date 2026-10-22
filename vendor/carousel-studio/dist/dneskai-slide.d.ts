import { type DneskaiKitId, type DneskaiSlideType, type DneskaiVariant } from "./dneskai-kits/contract.js";
export { DNESKAI_KITS, dneskaiKit } from "./dneskai-kits/registry.js";
export { DNESKAI_KIT_IDS, DNESKAI_DEFAULT_KIT, DNESKAI_SLIDE_TYPES, DNESKAI_VARIANTS, DNESKAI_TEMPLATE_ROLES, dneskaiRoleOf, DNESKAI_TEXT_FIELDS, DNESKAI_CODE_OWNED_SLOTS, DNESKAI_TEXT_LIMITS, dneskaiImageSlots, DNESKAI_TEMPLATE_VARIANTS } from "./dneskai-kits/contract.js";
export type { DneskaiKitId, DneskaiSlideType, DneskaiVariant, DneskaiTemplateRole, DneskaiTextField } from "./dneskai-kits/contract.js";
export type { DneskaiKit, DneskaiKitTemplate, DneskaiFieldFace } from "./dneskai-kits/kit.js";
export type { DneskaiFlow, DneskaiLayoutMetrics } from "./dneskai-layout.js";
import { type CarouselPayload, type ImageCrop } from "./schema.js";
/**
 * One DNESKAi Instagram slide, rendered from words and photographs (quorum#603, own-dashboard#110).
 *
 * The API OwnDashboard calls. It picks the photo-kit template for the slide type, writes the
 * strings code owns (the folio, the sources slide's title and its disclosure), decodes and crops
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
export declare const DNESKAI_BLEED_MIN_SHORT_SIDE = 900;
/**
 * The most a full-bleed crop may stretch the pixels it cuts; past it the slide is refused.
 *
 * The farthest a picture that passes the 900 px rule is ever stretched at zoom 1: a 16:9 hero
 * 900 px tall gives a 720 × 900 region, drawn to the 1350 px edge. A zoom, or a crop that cuts
 * less of the picture, may not stretch it further; that is refused like a smaller original.
 */
export declare const DNESKAI_BLEED_MAX_UPSCALE: number;
/**
 * A full-bleed crop stretched past this, but within `DNESKAI_BLEED_MAX_UPSCALE`, renders and is
 * reported as `image-upscaled`: 900 px across the 1080 px width.
 */
export declare const DNESKAI_BLEED_SOFT_UPSCALE: number;
/** The stored file formats a slide decodes. Anything else, SVG included, is refused unread. */
export declare const DNESKAI_IMAGE_FORMATS: readonly ["jpeg", "png", "webp"];
/** Which of `DNESKAI_IMAGE_FORMATS` a file is, by its signature, or null for anything else. */
export declare function sniffImageFormat(bytes: Uint8Array): (typeof DNESKAI_IMAGE_FORMATS)[number] | null;
/** The largest file a slide takes, in bytes. */
export declare const DNESKAI_MAX_IMAGE_BYTES: number;
/** The most pixels a slide decodes from one file, so a fetched picture has a bounded cost. */
export declare const DNESKAI_MAX_IMAGE_PIXELS = 64000000;
/** A framed photograph resampled past this factor is reported, not refused. */
export declare const DNESKAI_FRAME_MAX_UPSCALE = 1.5;
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
    kicker?: string;
    credit?: string;
    /** The sources slide's lines, one source each, at most `DNESKAI_MAX_SOURCES`. */
    sources?: readonly string[];
    images?: readonly DneskaiImageInput[];
    /** The slide's place in the carousel. The folio prints it; a single post is `{ 0, 1 }`. */
    position: {
        index: number;
        count: number;
    };
    locale?: "cs" | "en";
}
export type DneskaiProblemCode = "kit-invalid" | "position-invalid" | "variant-invalid" | "text-missing" | "text-clipped" | "sources-missing" | "sources-too-many" | "image-missing" | "image-unexpected" | "image-duplicate" | "image-undecodable" | "image-unsupported" | "image-hash-mismatch" | "image-low-resolution" | "image-upscaled" | "crop-invalid";
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
    template: {
        id: string;
        version: string;
    } | null;
    /** The exact payload the slide was (or would have been) drawn from. */
    payload: CarouselPayload | null;
}
/** Every problem the slide has, without rendering it. */
export declare function validateDneskaiSlide(input: DneskaiSlideInput): Promise<DneskaiSlideProblem[]>;
/** Render one slide, or refuse with the problems that stop it. */
export declare function renderDneskaiSlide(input: DneskaiSlideInput): Promise<DneskaiSlideResult>;
//# sourceMappingURL=dneskai-slide.d.ts.map