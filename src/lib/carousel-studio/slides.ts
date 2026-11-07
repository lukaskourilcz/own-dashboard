/**
 * Turn a finished article into a carousel deck.
 *
 * Five to ten slides, none longer than thirty words, chosen deterministically from text the
 * desk already wrote and already gated. No model call: splitting prose at a sentence boundary
 * is arithmetic, and paying a model to do it would add cost, latency and a way for the deck to
 * say something the article does not.
 *
 * The two magazines hand in different shapes. A Caught Up edition arrives with the editor's own
 * structure — what changed, why it matters, what is still open — and those become slides
 * directly. An MMA Files article is a title, a dek and a body, so its middle is cut out of the
 * body. Both land in the same five-to-ten range through different routes, which is why this is
 * two readers over one splitter rather than one clever function.
 */

import { INSTAGRAM_MAX_SLIDES, INSTAGRAM_MIN_SLIDES } from "./canvas.js";

/** No slide may exceed this. The owner's constraint, and the only hard rule here. */
export const MAX_SLIDE_WORDS = 30;
export const MIN_SLIDES = 5;
/**
 * Eight, on the owner's instruction. A ten-slide deck asks a reader for ten swipes to reach a
 * point that fits in six, and the cover and the closing line are two of the ten.
 *
 * Nine- and ten-slide templates stay resolvable — `state/social/packs/2026-08-06.json` names
 * `deck-spotlight-10` and a stored pack must keep rendering — but nothing selects one any more.
 */
export const MAX_SLIDES = 8;
/**
 * Seven, for anything built from here on, on the owner's launch instruction: five to seven.
 *
 * Separate from `MAX_SLIDES` on purpose. That eight is the rule a deck is *reviewed* against, and
 * `state/social/packs/` holds eight-slide decks that must go on passing review; this is the
 * narrower shape the builder now produces. Lowering the review bound instead would retroactively
 * make already-approved work unpublishable, which is a different and worse change.
 */
export const QUEUE_MAX_SLIDES = 7;
/** The longest deck the generator still builds a template for, so stored references resolve. */
export const MAX_RESOLVABLE_SLIDES = 10;

export interface Slide {
  /**
   * cover and outro bracket the deck; body carries the argument.
   *
   * `hook` is the second slide, and it is its own kind because the platform makes it one:
   * Instagram re-serves a carousel opening on a slide the reader has not seen, so slide two is
   * where a returning reader starts. The kind travels with the text so a composer can give that
   * slide an entry point's layout rather than the third beat of a rhythm.
   */
  kind: "cover" | "hook" | "body" | "outro";
  text: string;
}

export interface ArticleDeckInput {
  title: string;
  /**
   * The cover line, when the desk wrote one for it.
   *
   * An article title is written for a page of prose; a cover is a square somebody scrolls past.
   * Both magazines' writers now produce a short Czech line for it in the same call that writes
   * the article, so it passes the same style review. Absent, the title is the cover, which is
   * what every deck built before this did.
   */
  coverLine?: string | undefined;
  dek: string;
  /** A Caught Up edition's structured points, in the order the editor put them. */
  points?: readonly string[];
  /** An MMA Files body, MDX. Used only when there are no structured points. */
  bodyMdx?: string;
  /** The closing line in the summary record's locale. */
  outro: string;
}

/**
 * Abbreviations whose trailing period does not end a sentence.
 *
 * "vs." is the one that matters most here and was found by looking at a rendered slide: an MMA
 * card is written "Grasso vs. Shevchenko 2", and splitting on it ended the slide at "Grasso
 * vs." with the opponent on the next one.
 */
const ABBREVIATIONS = ["vs", "tj", "tzv", "např", "atd", "apod", "mj", "st", "sv", "č", "str", "roč", "resp", "cca"];

/**
 * A sentence boundary in Czech.
 *
 * Not simply "a period followed by a space". Czech writes ordinals with a trailing period, so
 * "UFC 306 dne 14. září 2024" holds two of them and a naive split puts "září 2024 a vyústila…"
 * on its own slide, starting mid-sentence in lower case. Abbreviations do the same thing in the
 * middle of a name. So a boundary needs: no digit before the period, no known abbreviation
 * before it, and a capital, digit or opening quote after it.
 */
const SENTENCE_END = new RegExp(
  `(?<!\\d)(?<!(?:^|[^\\p{L}])(?:${ABBREVIATIONS.join("|")}))(?<=[.!?…])\\s+(?=[\\p{Lu}\\d"„«(])`,
  "u"
);

function words(value: string): string[] {
  return value.trim().split(/\s+/u).filter(Boolean);
}

export function wordCount(value: string): number {
  return words(value).length;
}

/**
 * Strip MDX to the prose a reader would see.
 *
 * Headings, list markers, source markers, links and images all carry syntax that would be
 * counted as words and printed on a slide. The link's label survives because it is the
 * sentence; its URL does not, because a slide cannot be clicked.
 */
export function proseFromMdx(mdx: string): string {
  return mdx
    .split(/\r?\n/u)
    .filter((line) => !/^\s*(?:import|export)\b/u.test(line))
    .join("\n")
    .replace(/```[\s\S]*?```/gu, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
    .replace(/\[\^source-\d+\]|\[source:[^\]]+\]/gu, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gmu, "")
    .replace(/^\s{0,3}[-*+]\s+/gmu, "")
    .replace(/^\s{0,3}>\s?/gmu, "")
    .replace(/[*_`]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

/**
 * Break one sentence that is already over the cap.
 *
 * Czech runs long compound sentences, so a clause boundary is tried first — a comma, semicolon,
 * colon or dash is a place a reader expects to pause, and splitting there keeps each piece
 * readable. Only when no clause boundary falls inside the cap does this cut at the word count,
 * which is a worse slide but an honest one: the alternative is dropping the sentence, and a
 * deck that silently omits a fact the article makes is worse than a deck that reads abruptly.
 */
function splitLongSentence(sentence: string): string[] {
  const all = words(sentence);
  if (all.length <= MAX_SLIDE_WORDS) return [sentence.trim()];
  const pieces: string[] = [];
  let remaining = all;
  while (remaining.length > MAX_SLIDE_WORDS) {
    const window = remaining.slice(0, MAX_SLIDE_WORDS);
    let cut = -1;
    for (let index = window.length - 1; index >= Math.ceil(MAX_SLIDE_WORDS / 3); index -= 1) {
      if (/[,;:–—-]$/u.test(window[index]!)) { cut = index + 1; break; }
    }
    if (cut < 0) cut = MAX_SLIDE_WORDS;
    pieces.push(remaining.slice(0, cut).join(" ").trim());
    remaining = remaining.slice(cut);
  }
  if (remaining.length > 0) pieces.push(remaining.join(" ").trim());
  return pieces;
}

/** Pack whole sentences into slides, never exceeding the cap, never cutting one needlessly. */
export function packIntoSlides(prose: string): string[] {
  const sentences = prose.split(SENTENCE_END).map((value) => value.trim()).filter(Boolean);
  const units = sentences.flatMap(splitLongSentence);
  const packed: string[] = [];
  let current: string[] = [];
  for (const unit of units) {
    const unitWords = wordCount(unit);
    const currentWords = current.reduce((total, value) => total + wordCount(value), 0);
    if (current.length > 0 && currentWords + unitWords > MAX_SLIDE_WORDS) {
      packed.push(current.join(" "));
      current = [];
    }
    current.push(unit);
  }
  if (current.length > 0) packed.push(current.join(" "));
  return packed;
}

/** One slide's worth of text, trimmed to the cap without leaving a dangling clause. */
function capped(value: string): string {
  const [first] = packIntoSlides(value);
  return first ?? words(value).slice(0, MAX_SLIDE_WORDS).join(" ");
}

/**
 * Build the deck.
 *
 * The count follows the article: a short piece has less to say and gets fewer slides. What it
 * will not do is pad — if the text cannot fill five slides, the deck is short and the caller
 * decides whether that is publishable. Inventing a slide to reach a number is how a carousel
 * starts saying things the article does not.
 *
 * The ceiling is `QUEUE_MAX_SLIDES`, so a deck built today is five to seven slides. Cover, dek and
 * outro are three of them, which leaves four for the article's own middle.
 */
export function buildArticleDeck(input: ArticleDeckInput): Slide[] {
  const middle = input.points && input.points.length > 0
    ? input.points.flatMap((point) => packIntoSlides(point))
    : packIntoSlides(proseFromMdx(input.bodyMdx ?? ""));
  const room = QUEUE_MAX_SLIDES - 3;
  return [
    { kind: "cover" as const, text: capped(input.coverLine?.trim() || input.title) },
    // The dek, and the deck's second entry point. Same text as before; what changed is that the
    // slide now says what it is for, so a family can compose it as an opening.
    { kind: "hook" as const, text: capped(input.dek) },
    ...middle.slice(0, room).map((text) => ({ kind: "body" as const, text })),
    { kind: "outro" as const, text: capped(input.outro) }
  ];
}

export interface DeckReview {
  slides: Slide[];
  publishable: boolean;
  problems: string[];
}

/** Check a deck against the rules rather than trusting the builder that made it. */
export function reviewDeck(slides: readonly Slide[], mode: "carousel" | "single-image" = "carousel"): DeckReview {
  const problems: string[] = [];
  if (mode === "single-image" && slides.length !== 1) {
    problems.push(`A single-image deck needs exactly one slide; this one has ${slides.length}.`);
  } else if (mode === "carousel" && slides.length < INSTAGRAM_MIN_SLIDES) {
    // The platform's own floor, reported in its own words. Below two Instagram does not have a
    // carousel to show, whatever the editorial band says, so this is a different failure from
    // "shorter than the deck we choose to build" and reads as one.
    problems.push(`Instagram needs at least ${INSTAGRAM_MIN_SLIDES} items for a carousel; this deck has ${slides.length}.`);
  } else if (mode === "carousel" && slides.length < MIN_SLIDES) {
    problems.push(`A deck needs at least ${MIN_SLIDES} slides; this one has ${slides.length}.`);
  }
  if (slides.length > INSTAGRAM_MAX_SLIDES) {
    problems.push(`Instagram accepts at most ${INSTAGRAM_MAX_SLIDES} items in one post; this deck has ${slides.length}.`);
  }
  if (slides.length > MAX_SLIDES) {
    problems.push(`A deck may not exceed ${MAX_SLIDES} slides; this one has ${slides.length}.`);
  }
  slides.forEach((slide, index) => {
    const count = wordCount(slide.text);
    if (count > MAX_SLIDE_WORDS) {
      problems.push(`Slide ${index + 1} has ${count} words, over the ${MAX_SLIDE_WORDS}-word limit.`);
    }
    if (count === 0) problems.push(`Slide ${index + 1} is empty.`);
  });
  return { slides: [...slides], publishable: problems.length === 0, problems };
}

/**
 * Which of the five designs a given article gets.
 *
 * Deterministic from a stable seed — the slug or the edition date — for two reasons. A cycle can
 * replay, and a replay that picked a different design would render different bytes and break the
 * package hash. And across a week of articles the decks vary on their own, without anyone
 * choosing, which is the point of having five.
 */
export function deckStyleFor(seed: string, styles: readonly string[]): string {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  return styles[hash % styles.length]!;
}
