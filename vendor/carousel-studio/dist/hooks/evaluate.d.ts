import type { Hook, Library, MmaPredicate, NewsPredicate, QuizPredicate, Surface } from "./schema.js";
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
export interface NewsContext {
    readonly subject: NewsSubject;
}
export interface MmaContext {
    readonly subject: MmaSubject;
}
/** Whichever surface's subject is in play. Each evaluator only ever sees its own. */
export type SurfaceContext = QuizContext | NewsContext | MmaContext;
export declare function evaluateQuizPredicate(predicate: QuizPredicate, context: QuizContext): boolean;
export declare function evaluateNewsPredicate(predicate: NewsPredicate, context: NewsContext): boolean;
export declare function evaluateMmaPredicate(predicate: MmaPredicate, context: MmaContext): boolean;
/**
 * `truthRequires` is a conjunction: every predicate must hold.
 *
 * There is no per-vertical substitution. A gate is a claim about the item in front of it, so
 * rewriting one to make a line reachable more often would render that line where it is untrue.
 */
export declare function hookIsEligible(hook: Hook, context: SurfaceContext): boolean;
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
export declare function eligibleFor(library: Library, context?: SurfaceContext): EligibleSet;
/**
 * The eligible set's fingerprint, recorded in `hook-assignment/1`.
 *
 * This is what bounds the agent override: a meeting may swap the assigned hook for another member
 * of the recorded set, and pack validation rehashes the set to prove the swap stayed inside it.
 * Order-independent on purpose — the set is the licence, and sorting it means a library reordering
 * cannot invalidate a committed pack's receipt.
 */
export declare function eligibleSetHash(ids: readonly string[]): string;
//# sourceMappingURL=evaluate.d.ts.map