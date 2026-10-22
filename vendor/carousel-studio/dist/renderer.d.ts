import { type BrandTokens, type CarouselFormat, type CarouselPayload, type CarouselTemplate } from "./schema.js";
import type { FaceMetrics } from "./font-metrics.generated.js";
import { type FittedText } from "./text.js";
import { type TemplateCheck } from "./validation.js";
import { type DeckPosition } from "./kit-style.js";
/** One text slot as the renderer sets it: its lines, its size and whether anything was cut. */
export interface TextSlotFit {
    slideIndex: number;
    slideId: string;
    slot: string;
    fitted: FittedText;
    /** The committed face used for fitting, including cap height for layout. */
    face: FaceMetrics;
}
/**
 * Every text slot of a template fitted exactly as the renderer will fit it, without drawing.
 *
 * For a caller that has to say "this headline will be cut" before it has the photographs a render
 * needs. Same parse, same kit faces and the same canvas as `renderSlides`; the ground a slide
 * stands on changes colours, never faces, so it is not needed here.
 */
export declare function carouselTextFits(input: Pick<CarouselRenderInput, "template" | "payload" | "brand" | "format" | "look">): TextSlotFit[];
export interface RenderedSlide {
    slideId: string;
    index: number;
    format: CarouselFormat;
    svg: string;
    svgHash: string;
    /** Slots whose text did not fit and were clipped. Empty when the slide rendered whole. */
    truncatedSlots: string[];
}
export interface CarouselRenderInput {
    /** Named kit look; absent preserves the kit palette and faces. */
    look?: string;
    template: CarouselTemplate;
    payload: CarouselPayload;
    brand: BrandTokens;
    format: CarouselFormat;
    /** Decoded PNG bytes per image slot. WebP will not decode inside an SVG data URI. */
    images?: Readonly<Record<string, Buffer>>;
    /**
     * Where the template's first slide sits in the deck that ships, when the deck is assembled from
     * single-slide templates. Absent means the template is the deck. A kit that grounds slides by
     * position or keeps its logo to the last slide reads it.
     */
    deck?: DeckPosition;
}
/**
 * The template checks as the renderer will apply them to this brand.
 *
 * `validateTemplateForBrand` judges the tokens it is handed. A kitted brand is not drawn in those:
 * it is drawn in its kit's palette and faces, with the template flattened as the kit asks, on any
 * of the kit's grounds a slide can stand on. The Design Lab's check column reads this, so a
 * template it shows as passing is one the renderer will draw. A brand whose kit cannot be used
 * fails every template, with the kit's reason.
 */
export declare function validateTemplateAsRendered(template: CarouselTemplate, brand: BrandTokens, format: CarouselFormat, look?: string): TemplateCheck[];
export { prepareCarouselImages, treatImage } from "./images.js";
export declare function renderCarouselSvg(input: CarouselRenderInput): RenderedSlide[];
/**
 * One slide of the deck, identical to `renderCarouselSvg(input)[index]`.
 *
 * Null when the deck has no such slide, which is a 404 and not an error.
 */
export declare function renderCarouselSlideSvg(input: CarouselRenderInput & {
    index: number;
}): RenderedSlide | null;
export declare function renderCarouselPng(input: CarouselRenderInput): Promise<Array<RenderedSlide & {
    png: Buffer;
    pngHash: string;
}>>;
/**
 * One slide's PNG, identical to `(await renderCarouselPng(input))[index]`.
 *
 * A preview that shows a reader one slide should cost one rasterisation. Going through
 * `renderCarouselPng` and discarding the rest cost a whole deck per slide, so opening a ten-slide
 * deck rasterised a hundred images to show ten.
 */
export declare function renderCarouselSlidePng(input: CarouselRenderInput & {
    index: number;
}): Promise<(RenderedSlide & {
    png: Buffer;
    pngHash: string;
}) | null>;
/**
 * Decode any stored image into the PNG bytes an image layer can embed.
 *
 * librsvg draws nothing at all for a WebP data URI — no error, no image, just the background —
 * and heroes are stored as WebP. Verified by rendering all three encodings and sampling pixels.
 * This lives beside the renderer because it is the renderer's requirement, not the caller's
 * problem, and it keeps sharp out of every package that wants a slide.
 *
 * Returns null rather than throwing: a hero that will not decode is a slide without a
 * photograph, which is a worse slide and not a failed render.
 */
export declare function toRenderablePng(bytes: Buffer | Uint8Array): Promise<Buffer | null>;
//# sourceMappingURL=renderer.d.ts.map