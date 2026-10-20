import { type FaceMetrics } from "./font-metrics.generated.js";
import type { PublishingLocale } from "./schema.js";
/**
 * The typefaces the engine ships with, and the arithmetic it measures them by.
 *
 * Two problems used to live here as one. The brands named system font stacks — `Arial Narrow,
 * Arial, sans-serif` — and no font file existed in the repository, so the render server drew in
 * whatever fontconfig happened to find and the PNG bytes were a property of the machine. And the
 * fitter charged every character a flat 0.56 em, which is about right for Czech sentence case and
 * about a fifth short for all-caps, so an uppercase headline measured as fitting and then drew
 * wider than the canvas.
 *
 * Both are answered the same way: the files are committed, they are handed to the rasteriser
 * explicitly, and their real advance widths are committed beside them. Nothing at render time
 * reads a font, asks the operating system for one, or estimates.
 */
/** Where the .ttf files live, resolved from this module so `dist/` and `src/` both find them. */
export declare const FONTS_DIRECTORY: string;
/** Every committed face, as absolute paths, in a stable order. */
export declare function fontFiles(): string[];
/** The families a brand may name. Anything else is a typo, and the schema will not catch it. */
export declare const FONT_FAMILIES: string[];
/**
 * The committed face closest to what a layer asked for.
 *
 * A template may name any weight from 300 to 900; a family carries the four or five the design
 * set actually uses. Rounding to the nearest committed weight — the heavier one on a tie — keeps
 * a request for 500 body text as body text, where falling through to a different family would be
 * a silent substitution of exactly the kind this whole task exists to end.
 */
export declare function resolveFace(family: string, weight: number): FaceMetrics;
/**
 * How wide a string sets, in em, before letter-spacing.
 *
 * Per character rather than per grapheme cluster: a combining sequence is measured as its parts,
 * which over-counts a little, and over-counting is the safe direction — it shrinks type that
 * would otherwise have run off the edge.
 */
export declare function measureEm(face: FaceMetrics, value: string): number;
/**
 * The mean advance of one character of a sample, in thousandths of an em.
 *
 * Only the characters the face actually carries are averaged. A character with no entry would
 * otherwise be charged the fallback, which would quietly turn "this face cannot set this
 * alphabet" into "this alphabet measures a bit differently" — a coverage failure disguised as
 * arithmetic. The word space is always in the sample, because a line is words rather than a word.
 *
 * `font-metrics.generated.ts` computes each face's `average` this way over `LATIN_LETTERS`, and
 * `script-capacity.test.ts` asserts the two agree for every committed face. That equality is what
 * keeps the generated table and this function from drifting into two different answers.
 */
export declare function averageAdvance(face: FaceMetrics, sample: string): number;
/**
 * What a capacity question should charge per character for a line set in this language.
 *
 * The Latin mean is the floor rather than the answer. Czech measures marginally *narrower* than
 * ASCII in every committed face — its accented vowels are the narrow ones — and lowering a
 * declared slot limit's headroom on that basis would be a loosening dressed up as precision. A
 * language that measures wider raises the charge; one that measures narrower does not lower it.
 */
export declare function capacityAverage(face: FaceMetrics, locale: PublishingLocale): number;
/** True only when the committed face contains the glyph; the fitter's width fallback does not count. */
export declare function hasCommittedGlyph(face: FaceMetrics, character: string): boolean;
/** Stable, de-duplicated list of characters that would otherwise fall back during rasterisation. */
export declare function missingCommittedGlyphs(face: FaceMetrics, value: string): string[];
//# sourceMappingURL=fonts.d.ts.map