import { z } from "zod";
import { type CarouselSummaryVenture } from "./summary.js";
/**
 * The words that travel with a deck.
 *
 * Captions and hashtags existed only as deterministic concatenations built inside the queue path
 * — the article's standfirst with a fixed sentence glued to it — so the Lab could show a deck and
 * nothing else, and there was no Threads text or story line anywhere. These four fields are
 * written by the desk that writes the article, in the same call, the way the carousel cover line
 * already is. No new paid call site: the cost rides the article.
 */
/** Bounds the desk writes to, and the reader's own limits, not a style preference. */
export declare const CAPTION_LIMIT = 500;
export declare const THREADS_LIMIT = 480;
/** The hook lint's cap for Czech: past this a story line stops being readable at a glance. */
export declare const STORY_LINE_LIMIT = 66;
export declare const SocialCopySchema: z.ZodObject<{
    igCaption: z.ZodString;
    hashtags: z.ZodArray<z.ZodString>;
    threadsText: z.ZodString;
    storyLine: z.ZodString;
}, z.core.$strip>;
export type SocialCopy = z.infer<typeof SocialCopySchema>;
export declare const SocialCopyPackSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"social-copy/1">;
    venture: z.ZodEnum<{
        "caught-up": "caught-up";
        "mma-files": "mma-files";
        kvorum: "kvorum";
        booksofhistory: "booksofhistory";
        "door-money": "door-money";
        "tehdejsi-svet": "tehdejsi-svet";
    }>;
    slug: z.ZodString;
    date: z.ZodString;
    locale: z.ZodEnum<{
        cs: "cs";
        en: "en";
    }>;
    copy: z.ZodObject<{
        igCaption: z.ZodString;
        hashtags: z.ZodArray<z.ZodString>;
        threadsText: z.ZodString;
        storyLine: z.ZodString;
    }, z.core.$strip>;
    heroCredit: z.ZodNullable<z.ZodString>;
    origin: z.ZodEnum<{
        desk: "desk";
        derived: "derived";
    }>;
}, z.core.$strip>;
export type SocialCopyPack = z.infer<typeof SocialCopyPackSchema>;
export declare class MissingCreditError extends Error {
    constructor();
}
/**
 * The caption as it is shown, exported and queued.
 *
 * Code appends the credit, never the model. Most of these heroes are CC BY or CC BY-SA and a
 * carousel reaching a feed without the credit is a licence breach rather than a formatting slip,
 * so a caption without it is not discouraged — it cannot be built. A model asked to remember
 * would remember most of the time, which is the same as not remembering.
 */
export declare function renderCaption(caption: string, heroCredit: string | null): string;
/** The caption plus its hashtags, which is what a `caption.txt` in an export holds. */
export declare function renderCaptionFile(pack: SocialCopyPack): string;
/** Latin letters and digits only: Instagram matches a diacritic tag as a different tag. */
export declare function normalizeHashtag(value: string): string;
/** The venture's base set, filled out from the article's own terms and bounded at ten. */
export declare function completeHashtags(venture: CarouselSummaryVenture, proposed: readonly string[]): string[];
/**
 * A copy pack for an article written before the desk wrote one.
 *
 * The same deterministic concatenation the queue path has always used, kept so that every article
 * already on disk still has a caption. Marked `derived`, because a reader of the record should be
 * able to tell the desk's sentence from the pipeline's.
 */
export declare function derivedCopyPack(input: {
    venture: CarouselSummaryVenture;
    locale?: SocialCopyPack["locale"];
    slug: string;
    date: string;
    headline: string;
    standfirst: string;
    closing: string;
    tags?: readonly string[];
    heroCredit: string | null;
}): SocialCopyPack;
/** The copy the desk wrote, bounded and normalized into a pack. Throws on anything out of bounds. */
export declare function deskCopyPack(input: {
    venture: CarouselSummaryVenture;
    locale?: SocialCopyPack["locale"];
    slug: string;
    date: string;
    copy: {
        igCaption: string;
        hashtags: readonly string[];
        threadsText: string;
        storyLine: string;
    };
    heroCredit: string | null;
}): SocialCopyPack;
//# sourceMappingURL=copy.d.ts.map