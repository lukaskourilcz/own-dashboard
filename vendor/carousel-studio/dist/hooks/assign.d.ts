import { type EligibleSet, type SurfaceContext } from "./evaluate.js";
import type { Hook, Language, Library, Vertical } from "./schema.js";
/**
 * The social-channel cooldown, which is not the in-app cooldown.
 *
 * In the app a hook is cooled per user, so a ten-day cooldown means a given reader waits ten days.
 * On a channel every follower sees every post, so there is no per-user dilution and wear-out hits
 * the whole audience at once. `docs/hooks/06-hook-brain.md` sets the channel rule at twice the
 * shipped cooldown with a fourteen-day floor — the floor matters because the always pool's
 * six-day cooldowns would otherwise let a line come round twice a fortnight on one account.
 */
export declare function channelCooldownDays(hook: Pick<Hook, "cooldownDays">): number;
/** Days between two ISO dates, positive when `later` is after `earlier`. */
export declare function daysBetween(earlier: string, later: string): number;
export interface ChannelPost {
    readonly date: string;
    readonly hookId: string;
    readonly archetype: string;
}
export interface PackIdentity {
    /** venture-channel, e.g. `devshark-instagram`. Cooldown and variety are scoped to this. */
    readonly channel: string;
    readonly date: string;
    readonly itemId: string;
}
export interface AssignInput {
    readonly library: Library;
    /** Required once a surface has a library. An empty library needs no subject to fail on. */
    readonly context?: SurfaceContext;
    readonly identity: PackIdentity;
    readonly vertical: Vertical;
    /** That channel's own history, most recent last. */
    readonly history: readonly ChannelPost[];
}
export interface CooldownSnapshot {
    readonly hookId: string;
    readonly lastPostedOn: string;
    readonly daysSince: number;
    readonly requiredDays: number;
}
export interface Assignment {
    readonly hook: Hook;
    readonly eligible: EligibleSet;
    /** Eligible, then cooled and variety-filtered. What an agent override may choose from. */
    readonly available: readonly string[];
    readonly cooldownSnapshot: readonly CooldownSnapshot[];
    readonly seed: string;
}
export type AssignResult = {
    readonly outcome: "assigned";
    readonly assignment: Assignment;
} | {
    readonly outcome: "no-hook";
    readonly reason: NoHookReason;
    readonly eligible: EligibleSet;
};
export type NoHookReason = "empty-library" | "empty-eligible-set";
/**
 * The pack's seed.
 *
 * Derived from pack identity — channel, date, item — and never from `Math.random()`. The studio's
 * hash-stable render guarantee has to hold for hook text exactly as it does for pixels: rebuilding
 * yesterday's pack from the same inputs must produce the same slide 1, or the receipt proves
 * nothing.
 */
export declare function assignmentSeed(identity: PackIdentity): string;
/**
 * Which hook fronts this pack, or why none does.
 *
 * The order is not interchangeable. Truth first: a hook whose gates do not hold is not eligible at
 * any price and nothing downstream can reach it. Then the channel cooldown, then archetype variety,
 * then a seeded pick over what survives. Cooldown and variety are allowed to empty the pool — the
 * fallback is the template's own headline, and a repeated hook on a public account costs more than
 * a plain one.
 */
export declare function assignHook(input: AssignInput): AssignResult;
/**
 * The hook line for one vertical and language, with `{topic}` filled.
 *
 * A token that survives to a slide is the library leaking its own template into the feed, so an
 * unfilled one throws here rather than rendering.
 */
export declare function renderHookText(input: {
    readonly hook: Hook;
    readonly vertical: Vertical;
    readonly language: Language;
    readonly topic: string;
}): string;
//# sourceMappingURL=assign.d.ts.map