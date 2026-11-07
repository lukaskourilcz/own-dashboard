import { createHash } from "node:crypto";
import type { Hook, Library, MmaPredicate, NewsPredicate, Predicate, QuizPredicate, Surface } from "./schema.js";

/**
 * What a quiz predicate is evaluated against.
 *
 * Kept structural rather than tied to a question type so the same evaluator serves the pack build,
 * the conformance-vector generator and the tests without any of them holding a full snapshot.
 */
export interface QuizSubject {
  readonly difficulty: number;
  readonly hasCode: boolean;
  readonly category: string;
  readonly optionCount: number;
  /**
   * The question's **canonical English** text, whatever language the hook will render in.
   *
   * `questionStartsWith` is bound to canonical English, not to the reader's language. Two reasons,
   * both structural rather than stylistic. First, `hook-assignment/1` records one eligible-set hash
   * per pack and the assigned hook renders in both EN and CS from that one assignment — a
   * language-aware gate would produce two different eligible sets for one assignment and the
   * contract could not hold. Second, Czech translations are optional in the bank and a translator
   * may legitimately open with "Z jakého důvodu" rather than "Proč"; binding eligibility to that
   * choice makes the gate a fact about the translation instead of a fact about the question. The
   * gate licenses "this asks why", which is true of the question in every language it is shown in.
   *
   * The cost is recorded honestly: `docs/hooks/04-schema-and-gates.md` asks that
   * `questionStartsWith` gates stay supplementary, so their questions must also be well served by
   * the always pool. They are — the always pool is twelve hooks.
   */
  readonly canonicalEnglishQuestion: string;
}

/**
 * What a news gate is evaluated against, from `article-frontmatter.ts`.
 *
 * Three fields, not the six `05-surfaces.md` sketched — see that doc for what was dropped and
 * why. `signalStrength` is the desk's own 0-100 score and is the only gate here that separates a
 * heavy day from a quiet one; delivered editions score 78-85, so a threshold below 78 licenses
 * nothing.
 */
export interface NewsSubject {
  readonly sourceCount: number;
  readonly primarySourceCount: number;
  /** Absent on an item the desk did not score; a threshold gate then cannot hold. */
  readonly signalStrength: number | null;
  readonly tags: readonly string[];
  readonly hasNumber: boolean;
}

/**
 * What an MMA gate is evaluated against, from `mma-files.ts`.
 *
 * `format` is doing the work `resultKnown` was meant to do: `fight-week-preview` and
 * `post-event-recap` make opposite promises, and gating them apart is what stops a hook teasing a
 * fight that already happened.
 */
export interface MmaSubject {
  readonly format: string;
  readonly fighterCount: number;
  readonly hasEvent: boolean;
  readonly sourceCount: number;
}

/** List key → the categories it contains, as each brand declares them in `config/marketingshark.json`. */
export type CategoryLists = Readonly<Record<string, readonly string[]>>;

export interface QuizContext {
  readonly subject: QuizSubject;
  readonly categoryLists: CategoryLists;
}

export interface NewsContext { readonly subject: NewsSubject; }
export interface MmaContext { readonly subject: MmaSubject; }

/** Whichever surface's subject is in play. Each evaluator only ever sees its own. */
export type SurfaceContext = QuizContext | NewsContext | MmaContext;

export function evaluateQuizPredicate(predicate: QuizPredicate, context: QuizContext): boolean {
  const { subject, categoryLists } = context;
  switch (predicate.kind) {
    case "always":
      return true;
    case "hasCode":
      return subject.hasCode;
    case "optionsAtLeast":
      return subject.optionCount >= predicate.count;
    case "optionsExactly":
      // Not a stricter `optionsAtLeast`: it licenses counted imagery, where the number is the
      // line. "Four branches. One merges." is false on a five-option question, and
      // `optionsAtLeast:4` would happily serve it there.
      return subject.optionCount === predicate.count;
    case "difficultyAtLeast":
      return subject.difficulty >= predicate.level;
    case "categoryIn":
      return (categoryLists[predicate.list] ?? []).includes(subject.category);
    case "questionStartsWith":
      return subject.canonicalEnglishQuestion
        .trimStart()
        .toLowerCase()
        .startsWith(predicate.prefix.toLowerCase());
  }
}

export function evaluateNewsPredicate(predicate: NewsPredicate, context: NewsContext): boolean {
  const { subject } = context;
  switch (predicate.kind) {
    case "always":
      return true;
    case "hasNumber":
      return subject.hasNumber;
    case "sourceCount":
      return subject.sourceCount >= predicate.count;
    case "primarySources":
      return subject.primarySourceCount >= predicate.count;
    case "signalStrengthAtLeast":
      // An unscored item fails the gate rather than defaulting past it. A weight claim on an
      // item nobody scored is a claim nothing licensed.
      return subject.signalStrength !== null && subject.signalStrength >= predicate.score;
    case "topicIn":
      return subject.tags.includes(predicate.topic);
  }
}

export function evaluateMmaPredicate(predicate: MmaPredicate, context: MmaContext): boolean {
  const { subject } = context;
  switch (predicate.kind) {
    case "always":
      return true;
    case "hasEvent":
      return subject.hasEvent;
    case "formatIs":
      return subject.format === predicate.format;
    case "fighterCount":
      return subject.fighterCount >= predicate.count;
    case "sourceCount":
      return subject.sourceCount >= predicate.count;
  }
}

/**
 * `truthRequires` is a conjunction: every predicate must hold.
 *
 * There is no per-vertical substitution. A gate is a claim about the item in front of it, so
 * rewriting one to make a line reachable more often would render that line where it is untrue.
 */
export function hookIsEligible(hook: Hook, context: SurfaceContext): boolean {
  return hook.truthRequires.every((predicate) => {
    switch (hook.surface) {
      case "quiz":
        return evaluateQuizPredicate(predicate as QuizPredicate, context as QuizContext);
      case "news":
        return evaluateNewsPredicate(predicate as NewsPredicate, context as NewsContext);
      case "mma":
        return evaluateMmaPredicate(predicate as MmaPredicate, context as MmaContext);
    }
  });
}

export interface EligibleSet {
  readonly surface: Surface;
  /** Library order, so an index into it means the same thing on every run. */
  readonly ids: readonly string[];
  readonly hash: string;
}

/**
 * The eligible set for one item, in library order.
 *
 * Library order rather than sorted order because the seeded pick indexes into this list, and a
 * reordering that changed the pick without changing the set would break reproducibility for a
 * reason no receipt records.
 */
export function eligibleFor(library: Library, context?: SurfaceContext): EligibleSet {
  // An unwritten library is the honest empty case: nothing is eligible and the pack takes its
  // `no-hook` fallback. It needs no subject, because there is nothing for a gate to hold against.
  if (library.hooks.length === 0) {
    return { surface: library.surface, ids: [], hash: eligibleSetHash([]) };
  }
  if (!context) {
    throw new Error(
      `The ${library.surface} evaluator needs a subject: a gate cannot hold or fail against nothing`
    );
  }
  const ids = library.hooks.filter((hook) => hookIsEligible(hook, context)).map((hook) => hook.id);
  return { surface: library.surface, ids, hash: eligibleSetHash(ids) };
}

/**
 * The eligible set's fingerprint, recorded in `hook-assignment/1`.
 *
 * This is what bounds the agent override: a meeting may swap the assigned hook for another member
 * of the recorded set, and pack validation rehashes the set to prove the swap stayed inside it.
 * Order-independent on purpose — the set is the licence, and sorting it means a library reordering
 * cannot invalidate a committed pack's receipt.
 */
export function eligibleSetHash(ids: readonly string[]): string {
  return createHash("sha256").update([...ids].sort().join("\n")).digest("hex");
}
