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
/** No slide may exceed this. The owner's constraint, and the only hard rule here. */
export declare const MAX_SLIDE_WORDS = 30;
export declare const MIN_SLIDES = 5;
/**
 * Eight, on the owner's instruction. A ten-slide deck asks a reader for ten swipes to reach a
 * point that fits in six, and the cover and the closing line are two of the ten.
 *
 * Nine- and ten-slide templates stay resolvable — `state/social/packs/2026-08-06.json` names
 * `deck-spotlight-10` and a stored pack must keep rendering — but nothing selects one any more.
 */
export declare const MAX_SLIDES = 8;
/**
 * Seven, for anything built from here on, on the owner's launch instruction: five to seven.
 *
 * Separate from `MAX_SLIDES` on purpose. That eight is the rule a deck is *reviewed* against, and
 * `state/social/packs/` holds eight-slide decks that must go on passing review; this is the
 * narrower shape the builder now produces. Lowering the review bound instead would retroactively
 * make already-approved work unpublishable, which is a different and worse change.
 */
export declare const QUEUE_MAX_SLIDES = 7;
/** The longest deck the generator still builds a template for, so stored references resolve. */
export declare const MAX_RESOLVABLE_SLIDES = 10;
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
export declare function wordCount(value: string): number;
/**
 * Strip MDX to the prose a reader would see.
 *
 * Headings, list markers, source markers, links and images all carry syntax that would be
 * counted as words and printed on a slide. The link's label survives because it is the
 * sentence; its URL does not, because a slide cannot be clicked.
 */
export declare function proseFromMdx(mdx: string): string;
/** Pack whole sentences into slides, never exceeding the cap, never cutting one needlessly. */
export declare function packIntoSlides(prose: string): string[];
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
export declare function buildArticleDeck(input: ArticleDeckInput): Slide[];
export interface DeckReview {
    slides: Slide[];
    publishable: boolean;
    problems: string[];
}
/** Check a deck against the rules rather than trusting the builder that made it. */
export declare function reviewDeck(slides: readonly Slide[], mode?: "carousel" | "single-image"): DeckReview;
/**
 * Which of the five designs a given article gets.
 *
 * Deterministic from a stable seed — the slug or the edition date — for two reasons. A cycle can
 * replay, and a replay that picked a different design would render different bytes and break the
 * package hash. And across a week of articles the decks vary on their own, without anyone
 * choosing, which is the point of having five.
 */
export declare function deckStyleFor(seed: string, styles: readonly string[]): string;
//# sourceMappingURL=slides.d.ts.map