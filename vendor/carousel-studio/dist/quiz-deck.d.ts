import { type CarouselRenderInput } from "./renderer.js";
import type { BrandTokens, CarouselFormat, CarouselTemplate } from "./schema.js";
/**
 * marketingShark's quiz carousel as one render path (quorum#575).
 *
 * The daily room renders a devShark package through these functions, and the Design Lab renders
 * the same package through them again when the owner edits a slide. Two copies of the slot mapping
 * would drift, and the first sign would be a re-rendered frame that no longer matches the slide the
 * gates passed, so the mapping lives here, in the render package both sides already depend on.
 *
 * Everything here is pure in its inputs: a slide's role, its template, the words on it and the
 * facts code owns. No model call, no network, no clock.
 */
export declare const QUIZ_SLIDE_ROLES: readonly ["hook", "context", "reveal", "why", "footer"];
export type QuizSlideRole = (typeof QUIZ_SLIDE_ROLES)[number];
/**
 * The per-slide caps the craft rules state. marketingShark's gates spread these into their own
 * `LIMITS`, and the Design Lab holds an owner's edit to the same numbers, so an edited slide can
 * never carry what the room would have sent back to the writer.
 */
export declare const QUIZ_SLIDE_LIMITS: {
    readonly hookChars: 80;
    readonly whyWords: 40;
    readonly headlineChars: 120;
    readonly bodyChars: 600;
    readonly altChars: 200;
    /** The queue item carries one alt text for the whole carousel, and the queue caps it at 1,000. */
    readonly altTotalChars: 1000;
};
/**
 * What code, not copy, puts on a slide: the brand's name and link, the correct letter and the
 * question's options and code. The room reads them from the brand and the question bank; the
 * package's render summary records them, so a later render needs neither.
 */
export interface QuizDeckFacts {
    displayName: string;
    productUrl: string;
    correctLetter: string;
    /** The question's options in the slide's language, unlettered, in bank order. */
    options: readonly string[];
    /** Fenced code the context slide must carry byte for byte. */
    codeBlocks: readonly string[];
}
/** "B. an array" and "B) an array" read as "an array"; the letter is printed beside it by code. */
export declare function stripAnswerLetter(value: string): string;
/** The options as the reader sees them, lettered, one per line. */
export declare function letteredQuizOptions(options: readonly string[]): string;
/**
 * Split the context slide's body into the code that must stay monospaced and the rest.
 *
 * The writer is asked to put the question's code on the context slide byte for byte, and it may
 * also restate the options there. The code slot is monospaced and the options slot is not, so the
 * two are separated deterministically rather than by asking for two fields: a line that opens with
 * a bare answer letter is an option, everything else is code.
 */
export declare function splitContextBody(body: string): {
    code: string;
    options: string;
};
/**
 * Map one slide's copy onto the slots its template requires.
 *
 * Each role renders from its own single-slide template, so a role can use the layout that suits
 * it: a poster for the hook, a stat for the reveal, a quote for the explanation, and the only
 * template that carries monospaced code for a question with code.
 */
export declare function quizSlideSlots(input: {
    role: QuizSlideRole;
    template: CarouselTemplate;
    headline: string;
    body: string;
    facts: QuizDeckFacts;
}): Record<string, string>;
/**
 * Which variant a role uses, where its template offers one. The hook and the footer share the
 * poster, so without this the deck would open and close on the same background.
 */
export declare function quizSlideVariant(role: QuizSlideRole, template: CarouselTemplate): string | undefined;
/**
 * Every required slot the mapping did not fill, as an empty string. The renderer throws on a
 * missing slot, and an empty one is a legitimate slide: undefined is the failure, empty a choice.
 */
export declare function completeQuizSlots(template: CarouselTemplate, slots: Record<string, string>): Record<string, string>;
/** The context-slide slots code fills from the bank; no edit to the copy can shorten them. */
export declare const QUIZ_CODE_OWNED_SLOTS: ReadonlySet<string>;
/** Which of the two copy fields fills a slot, so a clip can name the field to shorten. */
export declare function quizSlotField(templateId: string, slot: string, hasBody: boolean): "headline" | "body" | "code";
/** How much text one slot holds, read from the template itself so no stale constant can disagree. */
export declare function quizSlotBudget(template: CarouselTemplate, slot: string): {
    maxChars: number;
    maxLines: number;
};
/** What the studio is handed for one slide: its template, its filled slots and its variant. */
export declare function quizSlideRenderInput(input: {
    role: QuizSlideRole;
    template: CarouselTemplate;
    headline: string;
    body: string;
    facts: QuizDeckFacts;
    locale: "cs" | "en";
    brand: BrandTokens;
    format: CarouselFormat;
}): CarouselRenderInput & {
    index: 0;
};
/** The quality Instagram's JPEG copies are encoded at. Instagram accepts JPEG only. */
export declare const QUIZ_FRAME_JPEG_QUALITY = 90;
/**
 * A frame's JPEG copy: flattened onto the brand's background, sRGB, with the profile embedded.
 * One encoder, so the room's copy and a Design Lab re-render of the same slide are the same bytes.
 */
export declare function quizFrameJpeg(png: Buffer, background: string): Promise<Buffer>;
/** One slide of a quiz deck as a package records it. */
export interface QuizSlideCopy {
    role: QuizSlideRole;
    template: CarouselTemplate;
    headline: string;
    body: string;
    alt: string;
}
export interface QuizSlideProblem {
    /** 1 to 5, the slide's position. */
    slide: number;
    field: "headline" | "body" | "alt" | "code";
    /** The template slot that would clip, when the problem is a clip. */
    slot: string | null;
    message: string;
}
/**
 * Every reason a deck of edited slides cannot be written, found before anything is.
 *
 * The caps are the room's own (`QUIZ_SLIDE_LIMITS`). The clip gate renders each slide and names
 * any slot the canvas would have to cut, with the field that fills it and the slot's budget. Three
 * rules the room also applies hold here: the reveal may not name a letter other than the correct
 * one, the context slide keeps the question's code byte for byte, and no field promises a reward
 * for engagement.
 */
export declare function reviewQuizSlides(input: {
    slides: readonly QuizSlideCopy[];
    facts: QuizDeckFacts;
    locale: "cs" | "en";
    brand: BrandTokens;
    format: CarouselFormat;
}): QuizSlideProblem[];
//# sourceMappingURL=quiz-deck.d.ts.map