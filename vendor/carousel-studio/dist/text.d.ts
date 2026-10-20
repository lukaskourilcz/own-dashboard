import type { PublishingLocale } from "./schema.js";
export interface FittedText {
    lines: string[];
    fontSize: number;
    truncated: boolean;
    normalized: string;
    /**
     * A word too long for the measure at every size the layer allows, broken to make it fit.
     *
     * Reported rather than hidden. The old fitter chopped any over-long word into fixed-size
     * fragments with no hyphen and no signal, then treated the chop as a successful fit and stopped
     * stepping down — so `NEJNEOBHOSPODAŘOVÁVATELNĚJŠÍ` set at full size as two fragments, both
     * running off the canvas, and every check said the slide was fine.
     */
    brokenWords: string[];
}
/**
 * Which spaces a line may not break at.
 *
 * Absent, any space breaks, which is what every carousel-template/1 layer has always done and must
 * keep doing: its recorded hashes were drawn that way. `cs` keeps the Czech typesetting ties
 * (ČSN 01 6910): a one-letter preposition or conjunction — v, k, s, z, o, u, a, i, in either
 * case — never ends a line but goes down with the word after it; the digit groups of one number
 * ("10 000") stay together; a number keeps the unit, percent sign or currency after it ("50 %",
 * "3 GB", "100 Kč", "10 mil."); and a no-break space the writer typed is honoured. The lines are
 * still drawn with ordinary spaces.
 */
export type KeepWithNext = "cs";
/**
 * The largest size at which a string sets inside its frame, and how it breaks there.
 *
 * Measured against the committed advance widths of the face the layer will actually be drawn in,
 * so all-caps is charged what all-caps costs and a condensed face is charged what it saves. A
 * candidate size is accepted only when every line — including the longest single word — fits the
 * measure whole. Falling all the way through, the minimum size is used and the word is broken,
 * which is a worse slide and is reported as one rather than passed off as a fit.
 */
export declare function fitText(input: {
    value: string;
    locale: "en" | "cs";
    widthPx: number;
    heightPx: number;
    minFontSize: number;
    maxFontSize: number;
    maxLines: number;
    maxChars: number;
    /** The family the layer draws in, as the brand names it. */
    fontFamily: string;
    fontWeight: number;
    /** Letter-spacing in em, which widens every character and so narrows every line. */
    tracking?: number;
    /** Spaces a line may not break at; absent, any space breaks (see `KeepWithNext`). */
    keepWithNext?: KeepWithNext;
}): FittedText;
/**
 * How many characters of a face fit one line, at a size, tracked, in one language.
 *
 * The overflow check's question, and it needs one number rather than a measured string: it is
 * asking whether a slot's declared character limit *could* fit, not whether one particular
 * passage does. The face's own mean letter width is the honest answer — a condensed headline is
 * charged what it saves, rather than every face being charged one constant fitted to Czech
 * sentence case in a grotesque.
 *
 * The language is part of the question for the same reason the face is. Literata sets Cyrillic
 * eight per cent wider than Latin, so a Ukrainian slot measured against the Latin mean is told it
 * holds twelve characters it cannot. Omitting the language charges the Latin mean, which is what
 * every slot was charged before languages were declared at all.
 */
export declare function charactersPerLine(input: {
    widthPx: number;
    fontSize: number;
    /** The family the slot draws in, as the brand names it. */
    family: string;
    weight: number;
    /** Letter-spacing in em, which widens every character and so shortens every line. */
    tracking?: number;
    locale?: PublishingLocale;
}): number;
//# sourceMappingURL=text.d.ts.map