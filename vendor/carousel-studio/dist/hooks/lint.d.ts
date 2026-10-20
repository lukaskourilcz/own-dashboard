import { type Surface } from "./schema.js";
/**
 * The craft caps from `docs/hooks/02-hook-craft-rules.md`, restated as numbers a check applies.
 *
 * They live here rather than in the doc alone for the reason the marketingShark gates give: a cap
 * the playbook asks for and no check enforces is a suggestion.
 */
export declare const HOOK_LIMITS: {
    readonly enChars: 58;
    readonly csChars: 66;
    /** CS may be longer than its EN sibling — parity of punch, not of word count — but not by much. */
    readonly csRatio: 1.25;
    /** Von Restorff at rotation level: no template may become wallpaper. */
    readonly archetypeShare: 0.2;
    /** Pool arithmetic: a gate a selector relies on must not collapse to one or two hooks. */
    readonly minHooksPerGate: 5;
};
export type FindingLevel = "error" | "warning";
export interface Finding {
    readonly level: FindingLevel;
    readonly rule: string;
    readonly surface: Surface;
    /** Absent for library-wide findings such as the archetype cap. */
    readonly hookId?: string;
    readonly detail: string;
}
export interface LintInput {
    readonly surface: Surface;
    readonly hooks: unknown;
    readonly research: unknown;
}
/**
 * Every check that stands between a hook library and a delivery.
 *
 * Load failures — an unknown predicate, a duplicate id, a hook with no research entry — are
 * reported as findings rather than thrown, so one run reports everything wrong with a library
 * instead of the first thing.
 */
export declare function lintLibrary(input: LintInput): Finding[];
export declare function hasErrors(findings: readonly Finding[]): boolean;
export declare function formatFindings(findings: readonly Finding[]): string;
//# sourceMappingURL=lint.d.ts.map