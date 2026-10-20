/**
 * What the reader actually sees behind every set of words, resolved once for every measure.
 *
 * A leaf module, importing only the schema's types and `brand-kit.ts`, which imports nothing from
 * the studio — the ring-avoidance rule `canvas.ts` and `designs.ts` both state at their own tops.
 *
 * This logic used to live inside `contrastCheck`'s closure, and it had to come out the moment a
 * second readability measure arrived. Two measures that each resolve their own grounds are two
 * answers to "what is behind this line of type", and two answers drift: the WCAG floor would be
 * measuring a panel while APCA measured the slide background, and the pair that failed would be
 * the pair nobody looked at. `validation.ts` and `contrast-apca.ts` now read this one list and
 * differ only in the arithmetic they apply to it.
 */
import { type KitLogotype } from "./brand-kit.js";
import type { BrandTokens, CarouselTemplate } from "./schema.js";
/**
 * One text or logo frame, the colour it is drawn in, and everything that can end up behind it.
 *
 * The smallest size and the weight travel with the pair because a readability floor depends on
 * them: 4.5:1 is one number for every size, but APCA's is not, and a threshold chosen without the
 * type size is a threshold chosen for the wrong text. A logo carries the renderer's own floor —
 * 18 px at weight 800 — rather than a guess, because that is what `layerSvg` clamps it to.
 */
export interface TextGround {
    slideId: string;
    /** The slot name, or `logo`. Spelled exactly as a failing check reports it. */
    target: string;
    foreground: string;
    /** Every colour that can sit behind those words in this rendering. */
    grounds: string[];
    minFontSize: number;
    fontWeight: number;
}
type Slide = CarouselTemplate["slides"][number];
/** One rendering of a slide: which token is the ground and which the accent resolves to. */
export interface SlideRendering {
    background: string;
    accent: string;
}
/**
 * Every colour that can sit behind one layer of one slide in one rendering.
 *
 * What is actually behind these words. The slide background used to be the whole answer, and it
 * refused designs a reader finds perfectly legible: `background`-coloured type on an `accent`
 * panel measures 6.17:1 and was reported as 1.00:1, because an opaque shape drawn beneath the
 * text was invisible to the check. The last opaque layer before the text that covers its frame —
 * a panel, a gradient whose two stops are two grounds, or a duotone photograph, which runs from
 * black to its tint — is what the reader sees, so that is what is measured.
 *
 * In a carousel-template/1 slide an untreated photograph still cannot be checked: its pixels are
 * the article's, not the template's, and the slide relies on the scrim its image layer draws. A
 * carousel-template/2 slide is measured against the photograph's two extremes instead (see
 * `photographGrounds`), which is what lets a v2 template promise words over any picture.
 *
 * Exported because the renderer asks the same question when it picks which logotype file to draw,
 * and a second answer would be a logo checked against one ground and drawn on another.
 */
export declare function groundsBehindLayer(slide: Slide, layerIndex: number, brand: BrandTokens, rendering: SlideRendering, 
/** True for a carousel-template/2 slide: words over a photograph are measured against it. */
options?: {
    photographs?: boolean;
}): string[];
/**
 * Every text and logo frame in this template, once per rendering the slide can produce.
 *
 * A brand with an outlined logotype from its kit is measured for what the renderer will draw: an
 * approved file on a ground its spec names is the brand's decision and adds no pair, and a
 * one-colour fallback is measured in its own ink. `logotype` defaults to the brand's kit.
 */
export declare function textGroundPairs(template: CarouselTemplate, brand: BrandTokens, logotype?: KitLogotype | null): TextGround[];
export {};
//# sourceMappingURL=grounds.d.ts.map