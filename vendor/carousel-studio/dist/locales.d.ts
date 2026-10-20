import type { BrandTokens, PublishingLocale } from "./schema.js";
/**
 * What each brand publishes in, and which characters that obliges its faces to draw.
 *
 * The studio measures type against committed advance widths, and until this file existed it
 * measured every language against one Latin sample. That is wrong in two directions at once. A
 * Cyrillic line is about eight per cent wider per character than a Latin one in the same face, so
 * a Ukrainian slot was told it fits when it does not; and a face that cannot draw a letter at all
 * renders a notdef box, which is the one rendering failure that looks deliberate.
 *
 * Both questions are answered from the same declaration: a brand says which languages it
 * publishes in, and the required alphabet and the capacity arithmetic are derived from that. A
 * thirteenth family added for a fourteenth brand inherits its gate from the brand's locales
 * rather than from a hand-maintained list of families somebody has to remember to extend.
 */
/** The letters a Latin line is made of, plus the word space, which is part of every measure. */
export declare const LATIN_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
/**
 * The language a brand's records are written in, first, then any further language it sets.
 *
 * Primary first is load-bearing: a slot that does not declare a language is set in the primary,
 * and a brand's secondary languages reach the page only through slots that name them. Tehdejší
 * svět is the case that forces the distinction — its records are Czech and its Ukrainian half
 * travels in declared `-ua` slots beside them, so charging every one of its slots the Cyrillic
 * average would fail thirty-six shared slots that will never hold a Cyrillic character.
 *
 * The primary is the same fact `localeForCarouselVenture` answers, and that function now reads
 * this map rather than keeping a second copy of it.
 */
export declare const BRAND_PUBLISHING_LOCALES: Readonly<Record<BrandTokens["id"], readonly ["cs" | "en", ...PublishingLocale[]]>>;
/** Every language this brand sets, primary first. */
export declare function publishingLocalesFor(brand: BrandTokens["id"]): readonly ["cs" | "en", ...PublishingLocale[]];
/** The language a slot is set in when it does not say. */
export declare function primaryLocaleFor(brand: BrandTokens["id"]): "cs" | "en";
/** The sample a line in this language is measured by. */
export declare function lettersFor(locale: PublishingLocale): string;
/**
 * Every character a face has to be able to draw to serve these languages.
 *
 * Latin is in the set whatever the languages are: the logo text, a URL, a credit line and a
 * proper noun are Latin on every card the studio renders, including the Ukrainian ones.
 */
export declare function requiredCharacters(locales: readonly PublishingLocale[]): string;
/** The families this brand binds, de-duplicated — a brand may put one face in two slots. */
export declare function familiesOf(brand: BrandTokens): string[];
//# sourceMappingURL=locales.d.ts.map