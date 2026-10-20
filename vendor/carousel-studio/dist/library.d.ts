import { type BrandTokens, type CarouselCanvas, type CarouselPayload, type CarouselTemplate } from "./schema.js";
import { type DeckStyle } from "./designs.js";
export declare const deckFormats: {
    readonly "instagram-square": {
        readonly width: 1080;
        readonly height: 1080;
        readonly safeArea: {
            readonly top: 0.06;
            readonly right: 0.06;
            readonly bottom: 0.08;
            readonly left: 0.06;
        };
    };
    readonly "instagram-portrait": {
        readonly width: 1080;
        readonly height: 1350;
        readonly safeArea: {
            readonly top: 0.06;
            readonly right: 0.06;
            readonly bottom: 0.08;
            readonly left: 0.06;
        };
    };
    readonly "instagram-story": {
        readonly width: 1080;
        readonly height: 1920;
        readonly safeArea: {
            readonly top: 0.14;
            readonly right: 0.07;
            readonly bottom: 0.16;
            readonly left: 0.07;
        };
    };
    readonly threads: {
        readonly width: 1200;
        readonly height: 1200;
        readonly safeArea: {
            readonly top: 0.07;
            readonly right: 0.07;
            readonly bottom: 0.09;
            readonly left: 0.07;
        };
    };
};
/**
 * What every generated deck declares: 4:5 master, the other three by derivation.
 *
 * Honest rather than generous. These compositions place every text and logo frame inside the union
 * of the four safe areas — the story's, which is the widest — which is the constraint
 * `families.ts` describes and `SAFE_TOP`/`SAFE_BOTTOM` below enforce. A layout composed that way
 * really does hold at 1:1 and 9:16, so it may say so; one composed for 4:5 alone may not, and gets
 * the schema's default, which is the master and nothing else.
 */
export declare function deckCanvas(): {
    master: CarouselCanvas;
    derive: CarouselCanvas[];
};
export declare const SAFE_TOP = 0.145;
export declare const SAFE_BOTTOM = 0.835;
/**
 * The slot a deck's Nth slide fills. One-based, zero-padded, so slots sort the way slides read.
 */
export declare function articleSlideSlot(index: number): string;
/** The slot the article's own hero occupies on the opening slide. */
export declare const ARTICLE_HERO_SLOT = "image";
/**
 * A deck template sized to the article and dressed in one of the five designs.
 *
 * Every other template in this file has a fixed slide array, which is right for a poster and wrong
 * for an article: how many slides a piece deserves is a property of the piece. The first slide
 * carries the article's own hero image; the rest carry its words.
 */
export declare function articleDeckTemplate(slideCount: number, style?: DeckStyle): CarouselTemplate;
export declare const SEED_TEMPLATES: readonly CarouselTemplate[];
export declare function articleDeckTemplates(): readonly CarouselTemplate[];
/** Everything a reference may resolve to. */
export declare function liveTemplates(): readonly CarouselTemplate[];
export declare const CAROUSEL_BRANDS: Readonly<Record<BrandTokens["id"], BrandTokens>>;
export declare function templateByReference(templateId: string, version: string): CarouselTemplate | null;
export declare function liveTemplateByReference(templateId: string, version: string): CarouselTemplate;
export declare function fixturePayload(template: CarouselTemplate, locale?: "en" | "cs", variant?: string): CarouselPayload;
/**
 * The canvases a template should be offered in.
 *
 * Called with no template this is every canvas the studio renders — what the preview route
 * accepts. Called with one it is the canvases that template is *composed for*, which is not the
 * same thing: the 9:16 story reserves roughly a seventh of the canvas at each end for the
 * platform's own chrome, and a layout designed for 4:5 places its logo and its closing line
 * squarely inside those bands.
 *
 * Two gates now, in this order. The template's own `canvas` declaration decides what it is willing
 * to be derived to — a template that declares nothing is offered its master alone — and the story
 * keeps its geometric check on top, because declaring 9:16 and composing for it are still two
 * different claims and only the second can be measured.
 *
 * That distinction is load-bearing rather than cosmetic. The lifecycle's checks run over these
 * formats and `resolveLifecycleStatus` reads the result, so offering every template the story
 * would have demoted every existing live template to draft the moment the format was added —
 * a new canvas quietly retiring the gallery is exactly the kind of break the render contract's
 * consumers are promised against.
 */
export declare function previewFormats(template?: CarouselTemplate): CarouselCanvas[];
//# sourceMappingURL=library.d.ts.map