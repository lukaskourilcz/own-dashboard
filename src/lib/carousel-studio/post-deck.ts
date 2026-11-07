import { renderCarouselSlideSvg, type CarouselRenderInput } from "./renderer.js";
import { completeQuizSlots, QUIZ_SLIDE_LIMITS, quizSlotBudget, type QuizSlideProblem } from "./quiz-deck.js";
import type { BrandTokens, CarouselFormat, CarouselTemplate } from "./schema.js";
import type { DeckPosition } from "./kit-style.js";

/**
 * marketingShark's post kinds beyond the quiz, as one render path (quorum#576).
 *
 * A feature spotlight, a challenge teaser, the week's note and the owner's launch announcement are
 * five-slide decks like the quiz, drawn from the same single-slide templates, one per slide. What
 * they lack is the quiz's facts — no options, no correct letter, no question code — so their slot
 * mapping is this smaller one: a headline, a body, the brand's name and link, and where the slide
 * sits in the deck. The room renders a package through it and a later render reproduces the room's
 * frames through it, so the mapping lives here, beside the quiz's, and nowhere else.
 */

/** What code, not copy, puts on these slides: the brand's name and its link. */
export interface PostDeckFacts {
  displayName: string;
  productUrl: string;
}

/** The opening slide, the closing one, or any between. The poster's variant and note follow it. */
export type PostSlidePlacement = "open" | "middle" | "close";

export function postSlidePlacement(index: number, count: number): PostSlidePlacement {
  return index === 0 ? "open" : index === count - 1 ? "close" : "middle";
}

/** The body's non-empty lines, which a list template prints one per slot. */
function bodyLines(body: string): string[] {
  return body.split("\n").map((line) => line.trim()).filter(Boolean);
}

/** Map one slide's words onto the slots its template requires. */
export function postSlideSlots(input: {
  template: CarouselTemplate;
  headline: string;
  body: string;
  placement: PostSlidePlacement;
  facts: PostDeckFacts;
}): Record<string, string> {
  const { headline, body, facts } = input;
  switch (input.template.id) {
    // Code names the brand on the closing slide only; the kit names it once, at the end.
    case "minimal-text-poster":
      return {
        "poster-line": headline,
        "poster-note": input.placement === "close" ? facts.productUrl.replace(/^https:\/\//u, "") : body
      };
    case "quote-card":
    case "story-quote":
      return { quote: body || headline, attribution: body ? headline : "" };
    case "stat-highlight":
      return { stat: headline, "stat-label": body, source: input.placement === "close" ? facts.displayName : "" };
    case "quiz-question-context": {
      // A headline over up to four lines, unlettered: the week's recap, one day per line.
      const lines = bodyLines(body);
      return { "question-line": headline, ...Object.fromEntries(["a", "b", "c", "d"].map((letter, index) => [`option-${letter}`, lines[index] ?? ""])) };
    }
    default:
      throw new Error(`No post-deck slot mapping for template ${input.template.id}`);
  }
}

/** The poster opens and closes a deck; its last variant closes it, so the two never look alike. */
export function postSlideVariant(placement: PostSlidePlacement, template: CarouselTemplate): string | undefined {
  const available = template.slides[0]?.variants ?? [];
  if (available.length === 0) return undefined;
  return placement === "close" ? available.at(-1)?.id : available[0]?.id;
}

/** Which of the two copy fields fills a slot, so a clip can name the field to shorten. */
export function postSlotField(templateId: string, slot: string, hasBody: boolean): "headline" | "body" {
  switch (`${templateId}/${slot}`) {
    case "minimal-text-poster/poster-note":
    case "stat-highlight/stat-label":
      return "body";
    case "quote-card/quote":
    case "story-quote/quote":
      return hasBody ? "body" : "headline";
    default:
      return slot.startsWith("option-") ? "body" : "headline";
  }
}

/** What the studio is handed for one slide: its template, its filled slots and its variant. */
export function postSlideRenderInput(input: {
  template: CarouselTemplate;
  headline: string;
  body: string;
  /** The slide's place in its deck, which sets its placement, its ground and whether the logo shows. */
  position: DeckPosition;
  facts: PostDeckFacts;
  locale: "cs" | "en";
  brand: BrandTokens;
  format: CarouselFormat;
}): CarouselRenderInput & { index: 0 } {
  const placement = postSlidePlacement(input.position.index, input.position.count);
  const variant = postSlideVariant(placement, input.template);
  return {
    template: input.template,
    brand: input.brand,
    format: input.format,
    index: 0,
    deck: input.position,
    payload: {
      locale: input.locale,
      strings: completeQuizSlots(input.template, postSlideSlots({ ...input, placement })),
      ...(variant ? { variant } : {})
    }
  };
}

/** One slide of a post deck as a package records it. */
export interface PostSlideCopy {
  role: string;
  template: CarouselTemplate;
  headline: string;
  body: string;
  alt: string;
}

/**
 * Every reason a post deck cannot be written, found before anything is: the room's own caps and
 * the clip gate, which renders each slide and names any slot the canvas would have to cut. The
 * caps are the quiz's (`QUIZ_SLIDE_LIMITS`), so a deck of any kind holds the same numbers.
 */
export function reviewPostSlides(input: {
  slides: readonly PostSlideCopy[];
  facts: PostDeckFacts;
  locale: "cs" | "en";
  brand: BrandTokens;
  format: CarouselFormat;
}): QuizSlideProblem[] {
  const problems: QuizSlideProblem[] = [];
  const limits = QUIZ_SLIDE_LIMITS;
  input.slides.forEach((slide, index) => {
    const number = index + 1;
    const add = (field: QuizSlideProblem["field"], message: string, slot: string | null = null) =>
      problems.push({ slide: number, field, slot, message: `Slide ${number} (${slide.role}): ${message}` });
    const headlineCap = index === 0 ? limits.hookChars : limits.headlineChars;
    if (slide.headline.length > headlineCap) add("headline", `the headline is ${slide.headline.length} characters; it holds ${headlineCap}.`);
    if (slide.body.length > limits.bodyChars) add("body", `the body is ${slide.body.length} characters; it holds ${limits.bodyChars}.`);
    if (slide.alt.trim().length === 0) add("alt", "the alt text is empty; every slide needs one.");
    if (slide.alt.length > limits.altChars) add("alt", `the alt text is ${slide.alt.length} characters; it holds ${limits.altChars}.`);
    const position = { index, count: input.slides.length };
    const rendered = renderCarouselSlideSvg(postSlideRenderInput({ ...slide, position, facts: input.facts, locale: input.locale, brand: input.brand, format: input.format }));
    for (const slot of rendered?.truncatedSlots ?? []) {
      const budget = quizSlotBudget(slide.template, slot);
      const field = postSlotField(slide.template.id, slot, slide.body.trim().length > 0);
      add(field, `the ${field} would clip in ${slot}, which holds ${budget.maxChars} characters on ${budget.maxLines} ${budget.maxLines === 1 ? "line" : "lines"}.`, slot);
    }
  });
  const altTotal = input.slides.map((slide) => slide.alt).join(" ").length;
  if (altTotal > limits.altTotalChars) {
    problems.push({ slide: 0, field: "alt", slot: null, message: `The five alt texts are ${altTotal} characters together; they hold ${limits.altTotalChars}.` });
  }
  return problems;
}
