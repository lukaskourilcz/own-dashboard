/**
 * The carousel summary: what a source package sends to the Design Lab.
 *
 * A carousel is a handful of frames. Sending a full article or an unshaped recommendation to the
 * studio would mean the renderer decides what the piece is about, which is a decision the desk
 * already made and wrote down. So delivery hands over a *summary* — the
 * headline, the standfirst, a small ordered set of passages and the sources — and the templates
 * parse that into slides.
 *
 * The function is deterministic and free: splitting prose at a sentence boundary is arithmetic,
 * and a model call here would add cost, latency and a way for a slide to say something the article
 * does not. Same article in, same summary out, so a replayed cycle renders identical bytes.
 *
 * This lives beside `slides.ts` and reuses its splitter rather than re-implementing sentence
 * detection — the Czech boundary rules there (ordinals, "vs.", abbreviations) were found by
 * looking at rendered slides, and a second copy would drift away from them.
 */
/** Fewer than this and no template has enough passages for its slide plan. */
export declare const MIN_SUMMARY_PASSAGES = 3;
/**
 * The ceiling. Template 07 (Stack) has the longest plan at 3–6 passage slides, and the loud
 * templates open one extra slide when a passage will not fit, so eight leaves headroom without
 * turning the carousel back into the article.
 */
export declare const MAX_SUMMARY_PASSAGES = 8;
export declare const CAROUSEL_SUMMARY_VENTURES: readonly ["caught-up", "mma-files", "kvorum", "booksofhistory", "door-money", "tehdejsi-svet", "devshark"];
export type CarouselSummaryVenture = (typeof CAROUSEL_SUMMARY_VENTURES)[number];
export type CarouselSummaryLocale = "cs" | "en";
/** One runtime source of truth for every venture that can deliver a Studio summary. */
export declare function isCarouselSummaryVenture(value: unknown): value is CarouselSummaryVenture;
/**
 * The language a venture publishes in. The locale is then recorded on every summary.
 *
 * Read from the brand's own declaration rather than kept here a second time. Every summary
 * venture is also a studio brand, and the brand map's primary is this same fact — the one the
 * type and layout gates measure against. Tehdejší svět is the case that shows why one copy
 * matters: Czech is its primary record and the Ukrainian half travels in declared slots inside
 * the package beside it, because one feature published twice is not two features.
 */
export declare function localeForCarouselVenture(venture: CarouselSummaryVenture): CarouselSummaryLocale;
export interface CarouselSummarySource {
    /** How the desk classified it: primary document, record, or an internal verified file. */
    kind: string;
    /** A human label. Never a repository path — those are internal and stay internal. */
    label: string;
}
export interface CarouselSummary {
    schemaVersion: "carousel-summary/1";
    venture: CarouselSummaryVenture;
    /** The source package's slug, which is also how the studio addresses it. */
    slug: string;
    /** Publication date, `YYYY-MM-DD`. */
    date: string;
    /** The language of this record; BOOKSOFHISTORY records its Czech and English twins separately. */
    locale: CarouselSummaryLocale;
    /** Absent means the normal multi-slide carousel; this opt-in record renders exactly one slide. */
    deckMode?: "single-image";
    /** The small mono line every template prints above the headline. */
    kicker: string;
    headline: string;
    /**
     * The line the desk wrote for the carousel cover.
     *
     * The summary path dropped `altHeadline`, so the templates tab showed a slide 1 built from the
     * article title while the ship path used the desk's cover line — two different first slides for
     * one article, from one engine. Optional, because every summary recorded before this field
     * existed still has to parse.
     */
    coverLine?: string;
    standfirst: string;
    /** The body of the carousel, in the order the article makes its argument. */
    passages: string[];
    closing: string;
    sources: CarouselSummarySource[];
    hasHero: boolean;
    /** The photograph's credit, as plain text. A carousel without it is a licence breach. */
    heroCredit: string | null;
}
interface CarouselSummaryContentInput {
    slug: string;
    date: string;
    /** A single-image recommendation is still a Studio record, but it is a one-slide poster. */
    deckMode?: "single-image";
    title: string;
    /** The desk's line for the carousel cover, when it wrote one. */
    coverLine?: string | undefined;
    dek: string;
    /** A recommendation may already carry its own gated outro; magazines use the venture default. */
    closing?: string;
    /** A Caught Up edition arrives already structured; those points are the passages. */
    points?: readonly string[];
    /** An MMA Files article arrives as MDX; its middle is cut out of the body. */
    bodyMdx?: string;
    sources?: readonly CarouselSummarySource[];
    hasHero?: boolean;
    heroCredit?: string | null;
}
export type CarouselSummaryInput = CarouselSummaryContentInput & ({
    venture: "caught-up" | "mma-files" | "kvorum";
    locale?: "cs";
} | {
    venture: "booksofhistory";
    locale: CarouselSummaryLocale;
} | {
    venture: "door-money";
    locale?: "en";
} | {
    venture: "tehdejsi-svet";
    locale?: "cs";
} | {
    venture: "devshark";
    locale?: "en";
});
/** `MMA Files · 6. srp` — the kicker every template prints, in the language the magazine publishes. */
export declare function summaryKicker(venture: CarouselSummaryVenture, date: string, locale?: CarouselSummaryLocale): string;
/**
 * Build the summary a source package sends to the Design Lab.
 *
 * A short article yields few passages and the summary says so rather than padding: a template
 * that needs four passage slides and is given two renders two, because inventing a third is how a
 * carousel starts making claims the article never made. `summaryIsRenderable` is the check a
 * caller runs before queueing one.
 */
export declare function buildCarouselSummary(input: CarouselSummaryInput): CarouselSummary;
export interface TehdejsiFeatureSummaryInput {
    recommendationId: string;
    date: string;
    slides: readonly {
        cs: string;
    }[];
    captionCs: string;
    dossierCount: number;
    photoAttribution: string | null;
}
/** The canonical Czech-primary rail record for one bilingual Tehdejsi svet package. */
export declare function buildTehdejsiCarouselSummary(input: TehdejsiFeatureSummaryInput): CarouselSummary;
export declare function tehdejsiCarouselSummaryPath(summary: CarouselSummary): string;
export interface BooksofhistoryFeatureSummaryInput {
    recommendationId: string;
    createdAt: string;
    locale: CarouselSummaryLocale;
    feature: {
        headline: string;
        caption: string;
        slides: readonly {
            text: string;
        }[];
    };
}
/** The single deterministic Design Lab handoff used by both cycle and admin approval writers. */
export declare function buildBooksofhistoryCarouselSummary(input: BooksofhistoryFeatureSummaryInput): CarouselSummary;
export declare function booksofhistoryCarouselSummaryPath(summary: CarouselSummary): string;
export interface CarouselSummaryReview {
    renderable: boolean;
    problems: string[];
}
/** Check a summary against the rules rather than trusting the builder that made it. */
export declare function reviewCarouselSummary(summary: CarouselSummary): CarouselSummaryReview;
/**
 * The passage-length band a piece of text falls in.
 *
 * The three bands are the studio's own switch — Short ≤ 90 characters, Medium 90–190, Long 190+ —
 * and every template declares a headline size for each. Deriving the band from the text rather
 * than from a slider is what keeps the render deterministic.
 */
export type PassageLength = "short" | "medium" | "long";
export declare function passageLength(value: string): PassageLength;
export {};
//# sourceMappingURL=summary.d.ts.map