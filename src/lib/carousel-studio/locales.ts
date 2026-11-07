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
export const LATIN_LETTERS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The fifteen Czech letters Latin does not have, in both cases. */
const CZECH_DIACRITICS = "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ";

/**
 * The Ukrainian alphabet, all thirty-three letters in both cases.
 *
 * `Ї ї Є є Ґ ґ І і` are the four pairs that separate it from Russian, and they are the reason this
 * cannot be shortened to "Cyrillic": a subset labelled that way routinely covers the Russian
 * alphabet and stops.
 */
const UKRAINIAN_LETTERS =
  "АБВГҐДЕЄЖЗИІЇЙКЛМНОПРСТУФХЦЧШЩЬЮЯабвгґдеєжзиіїйклмнопрстуфхцчшщьюя";

/** The letters a line in this language is made of, which is what a capacity average averages. */
const LETTERS: Readonly<Record<PublishingLocale, string>> = {
  en: LATIN_LETTERS,
  cs: `${LATIN_LETTERS}${CZECH_DIACRITICS}`,
  // Cyrillic only. A Ukrainian line is set in Cyrillic, and diluting the sample with the Latin
  // letters the same card may also carry would under-charge every Ukrainian slot on it.
  uk: UKRAINIAN_LETTERS
};

/**
 * Characters an orthography needs *inside* a word, over and above its letters.
 *
 * Ukrainian sets its apostrophe as U+02BC MODIFIER LETTER APOSTROPHE, not as a quote mark, so a
 * face that stops at the Cyrillic block draws a box in the middle of `з'їзд`. Figtree is missing
 * this character; no brand that binds Figtree publishes Ukrainian, which is exactly why the
 * requirement is derived from the locale rather than asserted over every committed face.
 */
const MARKS: Readonly<Record<PublishingLocale, string>> = { en: "", cs: "", uk: "ʼ" };

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
export const BRAND_PUBLISHING_LOCALES: Readonly<
  Record<BrandTokens["id"], readonly ["cs" | "en", ...PublishingLocale[]]>
> = {
  "caught-up": ["cs"],
  "mma-files": ["cs"],
  // An English-named owned brand whose channel strategy carries both languages.
  "titty-tuesdays": ["en", "cs"],
  // The question bank requires English and makes Czech optional, so English is the primary and
  // the Czech pass is the second rendering of the same question.
  devshark: ["en", "cs"],
  kvorum: ["cs"],
  booksofhistory: ["cs", "en"],
  "door-money": ["en"],
  "tehdejsi-svet": ["cs", "uk"],
  "webdev-signal": ["cs", "en"]
};

/** Every language this brand sets, primary first. */
export function publishingLocalesFor(brand: BrandTokens["id"]): readonly ["cs" | "en", ...PublishingLocale[]] {
  return BRAND_PUBLISHING_LOCALES[brand];
}

/** The language a slot is set in when it does not say. */
export function primaryLocaleFor(brand: BrandTokens["id"]): "cs" | "en" {
  return BRAND_PUBLISHING_LOCALES[brand][0];
}

/** The sample a line in this language is measured by. */
export function lettersFor(locale: PublishingLocale): string {
  return LETTERS[locale];
}

/**
 * Every character a face has to be able to draw to serve these languages.
 *
 * Latin is in the set whatever the languages are: the logo text, a URL, a credit line and a
 * proper noun are Latin on every card the studio renders, including the Ukrainian ones.
 */
export function requiredCharacters(locales: readonly PublishingLocale[]): string {
  const required = new Set<string>(LATIN_LETTERS);
  for (const locale of locales) {
    for (const character of `${LETTERS[locale]}${MARKS[locale]}`) required.add(character);
  }
  return [...required].join("");
}

/** The families this brand binds, de-duplicated — a brand may put one face in two slots. */
export function familiesOf(brand: BrandTokens): string[] {
  return [...new Set([brand.fonts.headline, brand.fonts.body, brand.fonts.mono])];
}
