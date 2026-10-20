import { renderCarouselSlideSvg } from "./renderer.js";
import { ENGAGEMENT_REWARD_REFUSAL, promisesEngagementReward } from "./engagement.js";
/**
 * marketingShark's quiz carousel as one render path (quorum#575).
 *
 * The daily room renders a devShark package through these functions, and the Design Lab renders
 * the same package through them again when the owner edits a slide. Two copies of the slot mapping
 * would drift, and the first sign would be a re-rendered frame that no longer matches the slide the
 * gates passed, so the mapping lives here, in the render package both sides already depend on.
 *
 * Everything here is pure in its inputs: a slide's role, its template, the words on it and the
 * facts code owns. No model call, no network, no clock.
 */
export const QUIZ_SLIDE_ROLES = ["hook", "context", "reveal", "why", "footer"];
/**
 * The per-slide caps the craft rules state. marketingShark's gates spread these into their own
 * `LIMITS`, and the Design Lab holds an owner's edit to the same numbers, so an edited slide can
 * never carry what the room would have sent back to the writer.
 */
export const QUIZ_SLIDE_LIMITS = {
    hookChars: 80,
    whyWords: 40,
    headlineChars: 120,
    bodyChars: 600,
    altChars: 200,
    /** The queue item carries one alt text for the whole carousel, and the queue caps it at 1,000. */
    altTotalChars: 1_000
};
/** "B. an array" and "B) an array" read as "an array"; the letter is printed beside it by code. */
export function stripAnswerLetter(value) {
    return value.replace(/^\s*[A-D]\s*[.):\u2013\u2014-]\s*/u, "").trim();
}
/** The options as the reader sees them, lettered, one per line. */
export function letteredQuizOptions(options) {
    return options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join("\n");
}
/**
 * Split the context slide's body into the code that must stay monospaced and the rest.
 *
 * The writer is asked to put the question's code on the context slide byte for byte, and it may
 * also restate the options there. The code slot is monospaced and the options slot is not, so the
 * two are separated deterministically rather than by asking for two fields: a line that opens with
 * a bare answer letter is an option, everything else is code.
 */
export function splitContextBody(body) {
    const lines = body.split("\n");
    const optionLines = lines.filter((line) => /^\s*[A-D][.):]\s/u.test(line));
    const codeLines = lines.filter((line) => !/^\s*[A-D][.):]\s/u.test(line));
    return {
        code: codeLines.join("\n").replace(/^\n+|\n+$/gu, ""),
        options: optionLines.join("\n").trim()
    };
}
/**
 * Map one slide's copy onto the slots its template requires.
 *
 * Each role renders from its own single-slide template, so a role can use the layout that suits
 * it: a poster for the hook, a stat for the reveal, a quote for the explanation, and the only
 * template that carries monospaced code for a question with code.
 */
export function quizSlideSlots(input) {
    const { headline, body, facts } = input;
    switch (input.template.id) {
        // The kit names devShark once, at the end: before the footer an empty body leaves the note
        // empty rather than filling it with the name.
        case "minimal-text-poster":
            return {
                "poster-line": headline,
                "poster-note": input.role === "footer" ? facts.productUrl.replace(/^https:\/\//u, "") : body
            };
        case "quiz-question-context":
            return { "question-line": headline, ...Object.fromEntries(["a", "b", "c", "d"].map((letter, index) => [
                    `option-${letter}`, facts.options[index] ? `${letter.toUpperCase()}. ${facts.options[index]}` : ""
                ])) };
        case "quiz-code-context": {
            const { code, options } = splitContextBody(body);
            return { "question-line": headline, "code-block": code, options: options || letteredQuizOptions(facts.options) };
        }
        case "stat-highlight":
            // The big figure on the reveal is the correct letter, and code owns it: an 18-character
            // one-line slot is no place for a sentence. The writer's words go to the label.
            if (input.role === "reveal") {
                return { stat: facts.correctLetter, "stat-label": stripAnswerLetter(body.trim() || headline), source: "" };
            }
            return { stat: headline, "stat-label": body, source: input.role === "footer" ? facts.displayName : "" };
        case "quote-card":
            return { quote: body || headline, attribution: body ? headline : "" };
        default:
            throw new Error(`No quiz slot mapping for template ${input.template.id}`);
    }
}
/**
 * Which variant a role uses, where its template offers one. The hook and the footer share the
 * poster, so without this the deck would open and close on the same background.
 */
export function quizSlideVariant(role, template) {
    const available = template.slides[0]?.variants ?? [];
    if (available.length === 0)
        return undefined;
    return role === "footer" ? available.at(-1)?.id : available[0]?.id;
}
/**
 * Every required slot the mapping did not fill, as an empty string. The renderer throws on a
 * missing slot, and an empty one is a legitimate slide: undefined is the failure, empty a choice.
 */
export function completeQuizSlots(template, slots) {
    return Object.fromEntries(template.requiredSlots.map((slot) => [slot, slots[slot] ?? ""]));
}
/** The context-slide slots code fills from the bank; no edit to the copy can shorten them. */
export const QUIZ_CODE_OWNED_SLOTS = new Set(["code-block", "options", "option-a", "option-b", "option-c", "option-d"]);
/** Which of the two copy fields fills a slot, so a clip can name the field to shorten. */
export function quizSlotField(templateId, slot, hasBody) {
    switch (`${templateId}/${slot}`) {
        case "stat-highlight/stat-label":
        case "quote-card/quote":
        case "minimal-text-poster/poster-note":
            return hasBody ? "body" : "headline";
        default:
            return QUIZ_CODE_OWNED_SLOTS.has(slot) ? "code" : "headline";
    }
}
/** How much text one slot holds, read from the template itself so no stale constant can disagree. */
export function quizSlotBudget(template, slot) {
    for (const slide of template.slides) {
        for (const layer of slide.layers) {
            if (layer.type === "text" && layer.slot === slot)
                return { maxChars: layer.maxChars, maxLines: layer.maxLines };
        }
    }
    throw new Error(`${template.id} has no text slot ${slot}`);
}
/** What the studio is handed for one slide: its template, its filled slots and its variant. */
export function quizSlideRenderInput(input) {
    const variant = quizSlideVariant(input.role, input.template);
    return {
        template: input.template,
        brand: input.brand,
        format: input.format,
        index: 0,
        // Each role is its own one-slide template; the deck is the five roles in order.
        deck: { index: QUIZ_SLIDE_ROLES.indexOf(input.role), count: QUIZ_SLIDE_ROLES.length },
        payload: {
            locale: input.locale,
            strings: completeQuizSlots(input.template, quizSlideSlots(input)),
            ...(variant ? { variant } : {})
        }
    };
}
/** The quality Instagram's JPEG copies are encoded at. Instagram accepts JPEG only. */
export const QUIZ_FRAME_JPEG_QUALITY = 90;
/**
 * A frame's JPEG copy: flattened onto the brand's background, sRGB, with the profile embedded.
 * One encoder, so the room's copy and a Design Lab re-render of the same slide are the same bytes.
 */
export async function quizFrameJpeg(png, background) {
    // Loaded on use, like the renderer's own rasteriser: the web preview imports this package and
    // must never load the native image runtime.
    const { default: sharp } = await import("sharp");
    return sharp(png)
        .flatten({ background })
        .toColourspace("srgb")
        .jpeg({ quality: QUIZ_FRAME_JPEG_QUALITY })
        .withIccProfile("srgb")
        .toBuffer();
}
const words = (value) => value.trim().split(/\s+/u).filter(Boolean).length;
/**
 * Every reason a deck of edited slides cannot be written, found before anything is.
 *
 * The caps are the room's own (`QUIZ_SLIDE_LIMITS`). The clip gate renders each slide and names
 * any slot the canvas would have to cut, with the field that fills it and the slot's budget. Three
 * rules the room also applies hold here: the reveal may not name a letter other than the correct
 * one, the context slide keeps the question's code byte for byte, and no field promises a reward
 * for engagement.
 */
export function reviewQuizSlides(input) {
    const problems = [];
    const limits = QUIZ_SLIDE_LIMITS;
    input.slides.forEach((slide, index) => {
        const number = index + 1;
        const add = (field, message, slot = null) => problems.push({ slide: number, field, slot, message: `Slide ${number} (${slide.role}): ${message}` });
        const headlineCap = slide.role === "hook" ? limits.hookChars : limits.headlineChars;
        if (slide.headline.length > headlineCap)
            add("headline", `the headline is ${slide.headline.length} characters; it holds ${headlineCap}.`);
        if (slide.body.length > limits.bodyChars)
            add("body", `the body is ${slide.body.length} characters; it holds ${limits.bodyChars}.`);
        for (const [field, value] of [["headline", slide.headline], ["body", slide.body], ["alt", slide.alt]]) {
            if (promisesEngagementReward(value))
                add(field, `${ENGAGEMENT_REWARD_REFUSAL}.`);
        }
        if (slide.alt.trim().length === 0)
            add("alt", "the alt text is empty; every slide needs one.");
        if (slide.alt.length > limits.altChars)
            add("alt", `the alt text is ${slide.alt.length} characters; it holds ${limits.altChars}.`);
        if (slide.role === "why" && words(`${slide.headline} ${slide.body}`) > limits.whyWords) {
            add("body", `the explanation is ${words(`${slide.headline} ${slide.body}`)} words; it holds ${limits.whyWords}.`);
        }
        if (slide.role === "reveal") {
            // Both fields, not the first that names a letter: code prints the body under the correct
            // letter, so "B" above "C. An object" is a slide that contradicts itself.
            for (const [field, value] of [["headline", slide.headline], ["body", slide.body]]) {
                const named = /^\s*([A-D])(?:\s*[.):\u2013\u2014-]|\s*$)/u.exec(value)?.[1];
                if (named && named !== input.facts.correctLetter)
                    add(field, `the reveal names ${named}; the correct answer is ${input.facts.correctLetter}.`);
            }
        }
        if (slide.role === "context") {
            const text = `${slide.headline}\n${slide.body}`;
            if (input.facts.codeBlocks.some((block) => !text.includes(block)))
                add("code", "the question's code is no longer on the slide byte for byte.");
        }
        const rendered = renderCarouselSlideSvg(quizSlideRenderInput({ ...slide, facts: input.facts, locale: input.locale, brand: input.brand, format: input.format }));
        for (const slot of rendered?.truncatedSlots ?? []) {
            const budget = quizSlotBudget(slide.template, slot);
            const field = quizSlotField(slide.template.id, slot, slide.body.trim().length > 0);
            add(field, `the ${field} would clip in ${slot}, which holds ${budget.maxChars} characters on ${budget.maxLines} ${budget.maxLines === 1 ? "line" : "lines"}.`, slot);
        }
    });
    const altTotal = input.slides.map((slide) => slide.alt).join(" ").length;
    if (altTotal > limits.altTotalChars) {
        problems.push({ slide: 0, field: "alt", slot: null, message: `The five alt texts are ${altTotal} characters together; they hold ${limits.altTotalChars}.` });
    }
    return problems;
}
//# sourceMappingURL=quiz-deck.js.map