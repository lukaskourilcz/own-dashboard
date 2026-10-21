import { type CategoryLists, type QuizSubject } from "./evaluate.js";
import type { Library, RawHook } from "./schema.js";
export declare const VECTORS_FILE = "hooks.predicates.spec.json";
export declare const VECTORS_SCHEMA_VERSION = "hook-predicate-vectors/1";
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
export declare function buildVectors(library: Library, rawHooks: readonly RawHook[]): VectorFile;
/** Re-run every vector against a library and return the ones that no longer hold. */
export declare function checkVectors(file: VectorFile): string[];
//# sourceMappingURL=vectors.d.ts.map