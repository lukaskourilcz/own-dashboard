import { type CarouselRenderInput } from "./renderer.js";
import { type QuizSlideProblem } from "./quiz-deck.js";
import type { BrandTokens, CarouselFormat, CarouselTemplate } from "./schema.js";
import type { DeckPosition } from "./kit-style.js";
/**
 * marketingShark's post kinds beyond the quiz, as one render path (quorum#576).
 *
 * A feature spotlight, a challenge teaser, the week's note and the owner's launch announcement are
 * five-slide decks like the quiz, drawn from the same single-slide templates, one per slide. What
 * they lack is the quiz's facts — no options, no correct letter, no question code — so their slot
 * mapping is this smaller one: a headline, a body, the brand's name and link, and where the slide
 * sits in the deck. The room renders a package through it and a later render reproduces the room's
 * frames through it, so the mapping lives here, beside the quiz's, and nowhere else.
 */
/** What code, not copy, puts on these slides: the brand's name and its link. */
export interface PostDeckFacts {
    displayName: string;
    productUrl: string;
}
/** The opening slide, the closing one, or any between. The poster's variant and note follow it. */
export type PostSlidePlacement = "open" | "middle" | "close";
export declare function postSlidePlacement(index: number, count: number): PostSlidePlacement;
/** Map one slide's words onto the slots its template requires. */
export declare function postSlideSlots(input: {
    template: CarouselTemplate;
    headline: string;
    body: string;
    placement: PostSlidePlacement;
    facts: PostDeckFacts;
}): Record<string, string>;
/** The poster opens and closes a deck; its last variant closes it, so the two never look alike. */
export declare function postSlideVariant(placement: PostSlidePlacement, template: CarouselTemplate): string | undefined;
/** Which of the two copy fields fills a slot, so a clip can name the field to shorten. */
export declare function postSlotField(templateId: string, slot: string, hasBody: boolean): "headline" | "body";
/** What the studio is handed for one slide: its template, its filled slots and its variant. */
export declare function postSlideRenderInput(input: {
    template: CarouselTemplate;
    headline: string;
    body: string;
    /** The slide's place in its deck, which sets its placement, its ground and whether the logo shows. */
    position: DeckPosition;
    facts: PostDeckFacts;
    locale: "cs" | "en";
    brand: BrandTokens;
    format: CarouselFormat;
}): CarouselRenderInput & {
    index: 0;
};
/** One slide of a post deck as a package records it. */
export interface PostSlideCopy {
    role: string;
    template: CarouselTemplate;
    headline: string;
    body: string;
    alt: string;
}
/**
 * Every reason a post deck cannot be written, found before anything is: the room's own caps and
 * the clip gate, which renders each slide and names any slot the canvas would have to cut. The
 * caps are the quiz's (`QUIZ_SLIDE_LIMITS`), so a deck of any kind holds the same numbers.
 */
export declare function reviewPostSlides(input: {
    slides: readonly PostSlideCopy[];
    facts: PostDeckFacts;
    locale: "cs" | "en";
    brand: BrandTokens;
    format: CarouselFormat;
}): QuizSlideProblem[];
//# sourceMappingURL=post-deck.d.ts.map