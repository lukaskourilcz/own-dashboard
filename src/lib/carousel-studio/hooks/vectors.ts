import { eligibleFor, type CategoryLists, type QuizSubject } from "./evaluate.js";
import { loadLibrary } from "./load.js";
import type { Library, RawHook } from "./schema.js";

export const VECTORS_FILE = "hooks.predicates.spec.json";
export const VECTORS_SCHEMA_VERSION = "hook-predicate-vectors/1";

export interface PredicateVector {
  readonly name: string;
  /** What this case pins down, so a failure reads as a spec violation rather than a diff. */
  readonly asserts: string;
  readonly subject: QuizSubject;
  readonly categoryLists: CategoryLists;
  /** The library slice this case is evaluated against, as raw library records. */
  readonly librarySlice: readonly RawHook[];
  readonly expectedEligibleIds: readonly string[];
}

export interface VectorFile {
  readonly schemaVersion: typeof VECTORS_SCHEMA_VERSION;
  readonly surface: "quiz";
  readonly note: string;
  readonly vectors: readonly PredicateVector[];
}

const CATEGORY_LISTS: CategoryLists = {
  core: ["internet", "git", "security", "databases", "testing"],
  commonUse: ["javascript", "typescript", "git", "css", "html", "react", "nodejs"],
  interview: ["dsa", "algorithms", "system-design", "databases", "javascript", "typescript"]
};

/** A question that satisfies nothing beyond `always`, which each case then varies one field of. */
const BASE: QuizSubject = {
  difficulty: 1,
  hasCode: false,
  category: "unlisted",
  optionCount: 2,
  canonicalEnglishQuestion: "What does this return?"
};

interface CaseSpec {
  readonly name: string;
  readonly asserts: string;
  readonly subject: Partial<QuizSubject>;
  readonly hookIds: readonly string[];
}

/**
 * The cases the two implementations are pinned to.
 *
 * Boundary values are the point: `difficultyAtLeast:4` is checked at 3, 4 and 5 and
 * `optionsAtLeast:4` at 3, 4 and 6, because an off-by-one in either direction is the failure that
 * an app selector and a studio evaluator can disagree on for months without either looking wrong.
 * The `questionStartsWith` cases pin the canonical-English binding: a question whose Czech opens
 * with "Proč" but whose English does not open with "Why" is **not** eligible, and the reverse is.
 */
const CASES: readonly CaseSpec[] = [
  { name: "always-only", asserts: "an ungated hook is eligible for any question", subject: {}, hookIds: ["payoff-explainer", "topic-audit"] },
  { name: "difficulty-below-gate", asserts: "difficultyAtLeast:4 excludes difficulty 3", subject: { difficulty: 3 }, hookIds: ["streak-breaker", "summit", "seniors-know", "payoff-explainer"] },
  { name: "difficulty-at-gate", asserts: "difficultyAtLeast:4 includes difficulty 4 — the boundary is inclusive", subject: { difficulty: 4 }, hookIds: ["streak-breaker", "summit", "seniors-know", "payoff-explainer"] },
  { name: "difficulty-above-gate", asserts: "difficultyAtLeast:4 includes difficulty 5", subject: { difficulty: 5 }, hookIds: ["streak-breaker", "summit", "seniors-know", "payoff-explainer"] },
  { name: "options-below-gate", asserts: "optionsAtLeast:4 excludes a three-option question", subject: { optionCount: 3, difficulty: 3 }, hookIds: ["eliminate-three", "blind-odds", "two-look-right", "payoff-explainer"] },
  { name: "options-at-gate", asserts: "optionsAtLeast:4 includes a four-option question — the boundary is inclusive", subject: { optionCount: 4, difficulty: 3 }, hookIds: ["eliminate-three", "blind-odds", "two-look-right", "payoff-explainer"] },
  { name: "options-above-gate", asserts: "optionsAtLeast:4 includes a six-option question", subject: { optionCount: 6, difficulty: 3 }, hookIds: ["eliminate-three", "blind-odds", "two-look-right", "payoff-explainer"] },
  { name: "options-exactly-below", asserts: "optionsExactly:4 excludes a three-option question", subject: { optionCount: 3 }, hookIds: ["four-doors", "payoff-explainer"] },
  { name: "options-exactly-at", asserts: "optionsExactly:4 includes a four-option question", subject: { optionCount: 4 }, hookIds: ["four-doors", "payoff-explainer"] },
  { name: "options-exactly-above", asserts: "optionsExactly:4 EXCLUDES a five-option question — this is the whole difference from optionsAtLeast", subject: { optionCount: 5 }, hookIds: ["four-doors", "payoff-explainer"] },
  { name: "options-exactly-vs-at-least", asserts: "five options satisfy optionsAtLeast:4 and not optionsExactly:4, side by side", subject: { optionCount: 5, difficulty: 3 }, hookIds: ["four-doors", "eliminate-three", "blind-odds"] },
  { name: "conjunction-partly-satisfied", asserts: "truthRequires is a conjunction: four options are not enough for a hook that also needs d2", subject: { optionCount: 4, difficulty: 1 }, hookIds: ["two-look-right", "final-two", "the-lineup", "eliminate-three"] },
  { name: "category-in-list", asserts: "categoryIn:commonUse matches a category the brand lists", subject: { category: "javascript" }, hookIds: ["everyday-blindspot", "autopilot", "depends-on-it", "interview-favorite"] },
  { name: "category-outside-list", asserts: "categoryIn:commonUse does not match a category the brand does not list", subject: { category: "cartography" }, hookIds: ["everyday-blindspot", "autopilot", "depends-on-it", "payoff-explainer"] },
  { name: "category-in-two-lists", asserts: "one category may satisfy two different list gates", subject: { category: "git" }, hookIds: ["everyday-blindspot", "depends-on-it", "interview-favorite"] },
  { name: "has-code", asserts: "hasCode gates the snippet hooks in", subject: { hasCode: true }, hookIds: ["spot-it", "half-in-the-snippet", "runtime-eyes", "payoff-explainer"] },
  { name: "no-code", asserts: "hasCode gates them out again", subject: { hasCode: false }, hookIds: ["spot-it", "half-in-the-snippet", "runtime-eyes", "payoff-explainer"] },
  { name: "starts-with-why", asserts: "questionStartsWith:Why matches the canonical English text", subject: { canonicalEnglishQuestion: "Why does the event loop drain microtasks first?" }, hookIds: ["know-why", "why-outlives", "payoff-explainer"] },
  { name: "starts-with-why-case-insensitive", asserts: "the prefix match ignores case", subject: { canonicalEnglishQuestion: "WHY is this immutable?" }, hookIds: ["know-why", "why-outlives"] },
  { name: "starts-with-why-leading-space", asserts: "leading whitespace in the question text does not defeat the gate", subject: { canonicalEnglishQuestion: "   Why is this immutable?" }, hookIds: ["know-why", "why-outlives"] },
  { name: "why-not-at-start", asserts: "the gate is a prefix, not a search: 'why' mid-sentence does not match", subject: { canonicalEnglishQuestion: "Explain why this is immutable." }, hookIds: ["know-why", "why-outlives"] },
  { name: "czech-why-english-what", asserts: "canonical-English binding: a question whose Czech opens 'Proč' but whose English opens 'What' is NOT eligible", subject: { canonicalEnglishQuestion: "What makes this immutable?" }, hookIds: ["know-why", "why-outlives", "payoff-explainer"] },
  { name: "english-why-czech-other", asserts: "canonical-English binding: English 'Why' is eligible however the Czech translation opens", subject: { canonicalEnglishQuestion: "Why is this immutable?" }, hookIds: ["know-why", "why-outlives", "payoff-explainer"] }
];

/**
 * Generate the conformance vectors from this repo's own evaluator.
 *
 * These were written to pin two implementations together — the studio's evaluator and a
 * selector in the quiz apps. That second implementation was withdrawn (see
 * `docs/hooks/06-hook-brain.md`), so what remains is a golden regression: the expectations are
 * computed rather than hand-written, and CI fails if a change to the evaluator silently moves
 * an eligible set. Worth keeping at that reduced value, because the boundary cases are exactly
 * where a gate quietly starts licensing a claim it should not.
 */
export function buildVectors(library: Library, rawHooks: readonly RawHook[]): VectorFile {
  const rawById = new Map(rawHooks.map((hook) => [hook.id, hook]));

  const vectors = CASES.map((entry) => {
    const subject: QuizSubject = { ...BASE, ...entry.subject };
    for (const id of entry.hookIds) {
      if (!rawById.has(id)) throw new Error(`Vector "${entry.name}" names hook "${id}", which is not in the library`);
    }
    // Library order, not the order the case happens to list its ids in. An eligible set is
    // consumed by an index — the seeded pick reads position — so a slice written in a different
    // order would make the file disagree with itself the moment anything re-derived it.
    const sliced: Library = {
      surface: "quiz",
      hooks: library.hooks.filter((hook) => entry.hookIds.includes(hook.id))
    };
    const slice = sliced.hooks.map((hook) => rawById.get(hook.id)!);
    return {
      name: entry.name,
      asserts: entry.asserts,
      subject,
      categoryLists: CATEGORY_LISTS,
      librarySlice: slice,
      expectedEligibleIds: eligibleFor(sliced, { subject, categoryLists: CATEGORY_LISTS }).ids
    } satisfies PredicateVector;
  });

  return {
    schemaVersion: VECTORS_SCHEMA_VERSION,
    surface: "quiz",
    note:
      "Generated by @boardlessai/carousel-studio from docs/hooks/04-schema-and-gates.md. "
      + "questionStartsWith is bound to the canonical English question text. "
      + "If the evaluator and these vectors disagree, the evaluator changed and the change is the thing to check.",
    vectors
  };
}

/** Re-run every vector against a library and return the ones that no longer hold. */
export function checkVectors(file: VectorFile): string[] {
  const failures: string[] = [];
  for (const vector of file.vectors) {
    const library = loadLibraryFromSlice(vector);
    const actual = eligibleFor(library, { subject: vector.subject, categoryLists: vector.categoryLists }).ids;
    if (actual.join(",") !== vector.expectedEligibleIds.join(",")) {
      failures.push(`${vector.name}: expected [${vector.expectedEligibleIds.join(", ")}], evaluator produced [${actual.join(", ")}]`);
    }
  }
  return failures;
}

/**
 * A vector's slice as a loadable library.
 *
 * The vectors carry no research records — an app has no use for them — so a synthetic one stands in
 * to satisfy the loader. Nothing the evaluator reads comes from it.
 */
function loadLibraryFromSlice(vector: PredicateVector): Library {
  return loadLibrary({
    surface: "quiz",
    hooks: vector.librarySlice,
    research: vector.librarySlice.map((hook) => ({
      id: hook.id,
      archetype: "vector-fixture",
      mechanism: "n/a",
      citation: "n/a",
      citationConfidence: "mechanism-only",
      whyItEarnsTheSwipe: "n/a",
      prediction: "n/a",
      falsifiedIf: "n/a",
      cooldownRationale: "n/a",
      risk: "n/a",
      gateJustification: "n/a"
    }))
  });
}
