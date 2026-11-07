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

import { primaryLocaleFor } from "./locales.js";
import { MAX_SLIDE_WORDS, packIntoSlides, proseFromMdx, wordCount } from "./slides.js";

/** Fewer than this and no template has enough passages for its slide plan. */
export const MIN_SUMMARY_PASSAGES = 3;

/**
 * The ceiling. Template 07 (Stack) has the longest plan at 3–6 passage slides, and the loud
 * templates open one extra slide when a passage will not fit, so eight leaves headroom without
 * turning the carousel back into the article.
 */
export const MAX_SUMMARY_PASSAGES = 8;

export const CAROUSEL_SUMMARY_VENTURES = [
  "caught-up",
  "mma-files",
  "kvorum",
  "booksofhistory",
  "door-money",
  "tehdejsi-svet",
  // marketingShark's devShark packages (quorum#575). Their slides render through marketingShark's
  // own quiz templates, not the family system; the summary is what lists them in the Design Lab.
  "devshark"
] as const;

export type CarouselSummaryVenture = (typeof CAROUSEL_SUMMARY_VENTURES)[number];
export type CarouselSummaryLocale = "cs" | "en";

/** One runtime source of truth for every venture that can deliver a Studio summary. */
export function isCarouselSummaryVenture(value: unknown): value is CarouselSummaryVenture {
  return typeof value === "string" && (CAROUSEL_SUMMARY_VENTURES as readonly string[]).includes(value);
}

/**
 * The language a venture publishes in. The locale is then recorded on every summary.
 *
 * Read from the brand's own declaration rather than kept here a second time. Every summary
 * venture is also a studio brand, and the brand map's primary is this same fact — the one the
 * type and layout gates measure against. Tehdejší svět is the case that shows why one copy
 * matters: Czech is its primary record and the Ukrainian half travels in declared slots inside
 * the package beside it, because one feature published twice is not two features.
 */
export function localeForCarouselVenture(venture: CarouselSummaryVenture): CarouselSummaryLocale {
  return primaryLocaleFor(venture);
}

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

export type CarouselSummaryInput = CarouselSummaryContentInput & (
  | { venture: "caught-up" | "mma-files" | "kvorum"; locale?: "cs" }
  | { venture: "booksofhistory"; locale: CarouselSummaryLocale }
  | { venture: "door-money"; locale?: "en" }
  | { venture: "tehdejsi-svet"; locale?: "cs" }
  | { venture: "devshark"; locale?: "en" }
);

const KICKER: Record<CarouselSummaryVenture, string> = {
  "caught-up": "DNESKAi",
  "mma-files": "MMA Files",
  kvorum: "KVÓRUM",
  booksofhistory: "BOOKSOFHISTORY",
  "door-money": "Door Money",
  "tehdejsi-svet": "Tehdejší svět",
  devshark: "devShark"
};

const CLOSING: Record<CarouselSummaryVenture, Record<CarouselSummaryLocale, string>> = {
  "caught-up": { cs: "Jedno vydání a máte přehled.", en: "One edition keeps you up to date." },
  "mma-files": { cs: "Celý ozdrojovaný text najdete v MMA Files.", en: "Read the fully sourced story in MMA Files." },
  kvorum: { cs: "Celý kontext a zdroje najdete v Kvóru.", en: "Read the full context and sources in Kvórum." },
  booksofhistory: { cs: "Příběh knihy pokračuje v pramenech.", en: "The book's story continues in the sources." },
  "door-money": { cs: "Zbytek příběhu žije v Door Money.", en: "The rest of the story lives in Door Money." },
  "tehdejsi-svet": { cs: "Zeptejte se někoho, kdo to zažil.", en: "Ask someone who was there." },
  // devShark ships English only. The table is total over both locales, so its Czech cell repeats
  // the English line rather than inventing Czech copy for a product that has none.
  devshark: { cs: "One question a day on devShark.", en: "One question a day on devShark." }
};

const MONTHS_CS = [
  "led", "úno", "bře", "dub", "kvě", "čvn",
  "čvc", "srp", "zář", "říj", "lis", "pro"
];

const MONTHS_EN = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/** `MMA Files · 6. srp` — the kicker every template prints, in the language the magazine publishes. */
export function summaryKicker(
  venture: CarouselSummaryVenture,
  date: string,
  locale?: CarouselSummaryLocale
): string {
  const resolvedLocale = locale ?? localeForCarouselVenture(venture);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(date);
  if (!match) return KICKER[venture];
  if (resolvedLocale === "en") {
    const month = MONTHS_EN[Number(match[2]) - 1];
    if (!month) return KICKER[venture];
    return venture === "door-money"
      ? `${KICKER[venture]} · ${month} ${Number(match[3])}`
      : `${KICKER[venture]} · ${Number(match[3])} ${month}`;
  }
  const month = MONTHS_CS[Number(match[2]) - 1];
  return month ? `${KICKER[venture]} · ${Number(match[3])}. ${month}` : KICKER[venture];
}

/** One line, never longer than a slide holds, cut at a sentence boundary rather than mid-clause. */
function oneLine(value: string): string {
  const [first] = packIntoSlides(value.trim());
  return first ?? value.trim().split(/\s+/u).slice(0, MAX_SLIDE_WORDS).join(" ");
}

/**
 * Choose the passages.
 *
 * The article's own order is kept — an argument reordered is an argument changed — and the
 * selection is a prefix, not a sample, so a reader who swipes the carousel reads the beginning of
 * the piece rather than a shuffle of its middle. Anything past the ceiling is simply not sent;
 * the article is where the rest lives, and the closing slide says so.
 */
function choosePassages(input: CarouselSummaryInput): string[] {
  const raw = input.points && input.points.length > 0
    ? input.points.flatMap((point) => packIntoSlides(point))
    : packIntoSlides(proseFromMdx(input.bodyMdx ?? ""));
  return raw
    .map((passage) => passage.trim())
    .filter((passage) => wordCount(passage) > 0)
    .slice(0, MAX_SUMMARY_PASSAGES);
}

/**
 * Build the summary a source package sends to the Design Lab.
 *
 * A short article yields few passages and the summary says so rather than padding: a template
 * that needs four passage slides and is given two renders two, because inventing a third is how a
 * carousel starts making claims the article never made. `summaryIsRenderable` is the check a
 * caller runs before queueing one.
 */
export function buildCarouselSummary(input: CarouselSummaryInput): CarouselSummary {
  if (input.venture === "booksofhistory" && input.locale === undefined) {
    throw new Error("BOOKSOFHISTORY summaries require an explicit per-record locale");
  }
  const locale = input.locale ?? localeForCarouselVenture(input.venture);
  return {
    schemaVersion: "carousel-summary/1",
    venture: input.venture,
    slug: input.slug,
    date: input.date,
    locale,
    ...(input.deckMode ? { deckMode: input.deckMode } : {}),
    kicker: summaryKicker(input.venture, input.date, locale),
    headline: oneLine(input.title),
    ...(input.coverLine ? { coverLine: oneLine(input.coverLine) } : {}),
    standfirst: oneLine(input.dek),
    passages: input.deckMode === "single-image" ? [] : choosePassages(input),
    closing: input.closing ? oneLine(input.closing) : CLOSING[input.venture][locale],
    sources: [...(input.sources ?? [])],
    hasHero: Boolean(input.hasHero),
    heroCredit: input.heroCredit ?? null
  };
}

export interface TehdejsiFeatureSummaryInput {
  recommendationId: string;
  date: string;
  slides: readonly { cs: string }[];
  captionCs: string;
  dossierCount: number;
  photoAttribution: string | null;
}

/** The canonical Czech-primary rail record for one bilingual Tehdejsi svet package. */
export function buildTehdejsiCarouselSummary(input: TehdejsiFeatureSummaryInput): CarouselSummary {
  const first = input.slides[0];
  if (!first) throw new Error("A Tehdejsi svet feature has no cover slide");
  return buildCarouselSummary({
    venture: "tehdejsi-svet",
    locale: "cs",
    slug: input.recommendationId,
    date: input.date,
    title: first.cs,
    dek: input.captionCs,
    points: input.slides.map(({ cs }) => cs),
    sources: [
      { kind: "facts", label: "Tehdejší svět verified facts" },
      ...(input.dossierCount > 0
        ? [{ kind: "dossier", label: "Tehdejší svět research dossier" }]
        : [])
    ],
    hasHero: input.photoAttribution !== null,
    heroCredit: input.photoAttribution
  });
}

export function tehdejsiCarouselSummaryPath(summary: CarouselSummary): string {
  if (summary.venture !== "tehdejsi-svet") {
    throw new Error("The Tehdejsi svet summary path accepts only its own venture");
  }
  return `ventures/carousel-studio/summaries/tehdejsi-svet/${summary.date}-${summary.slug}.json`;
}

export interface BooksofhistoryFeatureSummaryInput {
  recommendationId: string;
  createdAt: string;
  locale: CarouselSummaryLocale;
  feature: {
    headline: string;
    caption: string;
    slides: readonly { text: string }[];
  };
}

/** The single deterministic Design Lab handoff used by both cycle and admin approval writers. */
export function buildBooksofhistoryCarouselSummary(
  input: BooksofhistoryFeatureSummaryInput
): CarouselSummary {
  const slug = input.recommendationId.replace(/^rec-/u, "");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw new Error("BOOKSOFHISTORY recommendation id cannot become a summary slug");
  }
  return buildCarouselSummary({
    venture: "booksofhistory",
    locale: input.locale,
    slug,
    date: input.createdAt.slice(0, 10),
    title: input.feature.headline,
    dek: input.feature.caption,
    points: input.feature.slides.map(({ text }) => text),
    sources: [{ kind: "dossier", label: "BOOKSOFHISTORY verified dossier" }],
    hasHero: false,
    heroCredit: null
  });
}

export function booksofhistoryCarouselSummaryPath(summary: CarouselSummary): string {
  if (summary.venture !== "booksofhistory") {
    throw new Error("BOOKSOFHISTORY summary storage accepts only its own venture records");
  }
  return `ventures/carousel-studio/summaries/booksofhistory/${summary.date}-${summary.slug}-${summary.locale}.json`;
}

export interface CarouselSummaryReview {
  renderable: boolean;
  problems: string[];
}

/** Check a summary against the rules rather than trusting the builder that made it. */
export function reviewCarouselSummary(summary: CarouselSummary): CarouselSummaryReview {
  const problems: string[] = [];
  if (summary.headline.trim().length === 0) problems.push("The summary has no headline.");
  if (summary.standfirst.trim().length === 0) problems.push("The summary has no standfirst.");
  if (summary.deckMode !== "single-image" && summary.passages.length < MIN_SUMMARY_PASSAGES) {
    problems.push(`A summary needs at least ${MIN_SUMMARY_PASSAGES} passages; this one has ${summary.passages.length}.`);
  }
  if (summary.passages.length > MAX_SUMMARY_PASSAGES) {
    problems.push(`A summary may not exceed ${MAX_SUMMARY_PASSAGES} passages; this one has ${summary.passages.length}.`);
  }
  summary.passages.forEach((passage, index) => {
    if (wordCount(passage) > MAX_SLIDE_WORDS) {
      problems.push(`Passage ${index + 1} has ${wordCount(passage)} words, over the ${MAX_SLIDE_WORDS}-word limit.`);
    }
  });
  if (summary.hasHero && !summary.heroCredit) {
    problems.push("The summary carries a hero with no credit, which a carousel cannot print.");
  }
  return { renderable: problems.length === 0, problems };
}

/**
 * The passage-length band a piece of text falls in.
 *
 * The three bands are the studio's own switch — Short ≤ 90 characters, Medium 90–190, Long 190+ —
 * and every template declares a headline size for each. Deriving the band from the text rather
 * than from a slider is what keeps the render deterministic.
 */
export type PassageLength = "short" | "medium" | "long";

export function passageLength(value: string): PassageLength {
  const length = value.trim().length;
  if (length <= 90) return "short";
  return length <= 190 ? "medium" : "long";
}
