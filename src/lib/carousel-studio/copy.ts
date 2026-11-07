import { z } from "zod";
import { localeForCarouselVenture, type CarouselSummaryVenture } from "./summary.js";

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
export const CAPTION_LIMIT = 500;
export const THREADS_LIMIT = 480;
/** The hook lint's cap for Czech: past this a story line stops being readable at a glance. */
export const STORY_LINE_LIMIT = 66;

export const SocialCopySchema = z.object({
  /** Instagram caption. The licence credit is *not* part of this — code appends it. */
  igCaption: z.string().trim().min(1).max(CAPTION_LIMIT),
  hashtags: z.array(z.string().regex(/^[a-z0-9]+$/)).min(5).max(10),
  threadsText: z.string().trim().min(1).max(THREADS_LIMIT),
  storyLine: z.string().trim().min(1).max(STORY_LINE_LIMIT)
});

export type SocialCopy = z.infer<typeof SocialCopySchema>;

export const SocialCopyPackSchema = z.object({
  schemaVersion: z.literal("social-copy/1"),
  venture: z.enum(["caught-up", "mma-files", "kvorum", "booksofhistory", "door-money", "tehdejsi-svet"]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  locale: z.enum(["cs", "en"]),
  copy: SocialCopySchema,
  /** The photograph's credit as plain text, or null when the article carries no photograph. */
  heroCredit: z.string().trim().min(1).nullable(),
  /** Whether the desk wrote this copy, or the pipeline derived it the old way. */
  origin: z.enum(["desk", "derived"])
}).superRefine((pack, context) => {
  if (pack.venture !== "booksofhistory" && pack.locale !== localeForCarouselVenture(pack.venture)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["locale"],
      message: `${pack.venture} social copy must use ${localeForCarouselVenture(pack.venture)}.`
    });
  }
});

export type SocialCopyPack = z.infer<typeof SocialCopyPackSchema>;

export class MissingCreditError extends Error {
  constructor() {
    super("A caption for an article with a photograph must carry the licence credit.");
  }
}

/**
 * The caption as it is shown, exported and queued.
 *
 * Code appends the credit, never the model. Most of these heroes are CC BY or CC BY-SA and a
 * carousel reaching a feed without the credit is a licence breach rather than a formatting slip,
 * so a caption without it is not discouraged — it cannot be built. A model asked to remember
 * would remember most of the time, which is the same as not remembering.
 */
export function renderCaption(caption: string, heroCredit: string | null): string {
  const body = caption.trim();
  if (heroCredit === null) return body;
  const credit = heroCredit.trim();
  if (!credit) throw new MissingCreditError();
  return body.includes(credit) ? body : `${body}\n\n${credit}`;
}

/** The caption plus its hashtags, which is what a `caption.txt` in an export holds. */
export function renderCaptionFile(pack: SocialCopyPack): string {
  const tags = pack.copy.hashtags.map((tag) => `#${tag}`).join(" ");
  return `${renderCaption(pack.copy.igCaption, pack.heroCredit)}\n\n${tags}\n`;
}

const HASHTAG_BASE: Readonly<Record<CarouselSummaryVenture, readonly string[]>> = {
  "caught-up": ["ai", "umelainteligence", "technologie", "aitech", "dneskai"],
  "mma-files": ["mma", "ufc", "oktagon", "bojovesporty", "mmafiles"],
  kvorum: ["kvorum", "politika", "cesko", "overeno", "verejnyzajem"],
  booksofhistory: ["booksofhistory", "bookhistory", "literaryhistory", "books", "publishinghistory"],
  "door-money": ["hiphop", "musicbusiness", "tourstories", "behindthescenes", "doormoney"],
  // Latin-only by the rule below, which is why the Ukrainian side contributes none of its own:
  // a transliterated Cyrillic tag is a tag nobody follows.
  "tehdejsi-svet": ["tehdejsisvet", "retro", "nostalgie", "historie", "ceskoslovensko"],
  devshark: ["devshark", "webdev", "javascript", "programming", "codingquiz"]
};

/** Latin letters and digits only: Instagram matches a diacritic tag as a different tag. */
export function normalizeHashtag(value: string): string {
  return value
    .normalize("NFD")
    .replaceAll(/[̀-ͯ]/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "");
}

/** The venture's base set, filled out from the article's own terms and bounded at ten. */
export function completeHashtags(venture: CarouselSummaryVenture, proposed: readonly string[]): string[] {
  const cleaned = proposed.map(normalizeHashtag).filter((tag) => tag.length >= 2 && tag.length <= 30);
  return [...new Set([...cleaned, ...HASHTAG_BASE[venture]])].slice(0, 10);
}

/**
 * A copy pack for an article written before the desk wrote one.
 *
 * The same deterministic concatenation the queue path has always used, kept so that every article
 * already on disk still has a caption. Marked `derived`, because a reader of the record should be
 * able to tell the desk's sentence from the pipeline's.
 */
export function derivedCopyPack(input: {
  venture: CarouselSummaryVenture;
  locale?: SocialCopyPack["locale"];
  slug: string;
  date: string;
  headline: string;
  standfirst: string;
  closing: string;
  tags?: readonly string[];
  heroCredit: string | null;
}): SocialCopyPack {
  const caption = `${input.standfirst}\n\n${input.closing}`.slice(0, CAPTION_LIMIT).trim();
  const threads = `${input.headline}\n\n${input.standfirst}`.slice(0, THREADS_LIMIT).trim();
  return SocialCopyPackSchema.parse({
    schemaVersion: "social-copy/1",
    venture: input.venture,
    slug: input.slug,
    date: input.date,
    locale: input.locale ?? localeForCarouselVenture(input.venture),
    copy: {
      igCaption: caption,
      hashtags: completeHashtags(input.venture, input.tags ?? []),
      threadsText: threads,
      storyLine: input.headline.slice(0, STORY_LINE_LIMIT).trim()
    },
    heroCredit: input.heroCredit,
    origin: "derived"
  });
}

/** The copy the desk wrote, bounded and normalized into a pack. Throws on anything out of bounds. */
export function deskCopyPack(input: {
  venture: CarouselSummaryVenture;
  locale?: SocialCopyPack["locale"];
  slug: string;
  date: string;
  copy: { igCaption: string; hashtags: readonly string[]; threadsText: string; storyLine: string };
  heroCredit: string | null;
}): SocialCopyPack {
  return SocialCopyPackSchema.parse({
    schemaVersion: "social-copy/1",
    venture: input.venture,
    slug: input.slug,
    date: input.date,
    locale: input.locale ?? localeForCarouselVenture(input.venture),
    copy: {
      igCaption: input.copy.igCaption.trim().slice(0, CAPTION_LIMIT),
      hashtags: completeHashtags(input.venture, input.copy.hashtags),
      threadsText: input.copy.threadsText.trim().slice(0, THREADS_LIMIT),
      storyLine: input.copy.storyLine.trim().slice(0, STORY_LINE_LIMIT)
    },
    heroCredit: input.heroCredit,
    origin: "desk"
  });
}
