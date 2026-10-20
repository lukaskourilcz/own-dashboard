import { type Library, type Predicate, type RawHook, type Surface } from "./schema.js";
/** A load-time failure that names the hook and the surface, because both are needed to fix it. */
export declare class HookLoadError extends Error {
    readonly surface: Surface;
    readonly hookId: string;
    constructor(surface: Surface, hookId: string, detail: string);
}
/**
 * `"difficultyAtLeast:3"` → `{ kind: "difficultyAtLeast", level: 3 }`.
 *
 * Everything this rejects, it rejects loudly. An unknown predicate cannot fall through to "no
 * condition" — that would promote a typo into an always-eligible hook, which is the one direction
 * this must never fail in — and it cannot fall through to "never eligible" either, because a hook
 * that silently stops rendering is a bug nobody sees until the pool starves.
 */
export declare function parsePredicate(surface: Surface, hookId: string, raw: string): Predicate;
export interface LoadLibraryInput {
    readonly surface: Surface;
    readonly hooks: unknown;
    readonly research: unknown;
}
/**
 * Parse one surface's library and its research file into hooks whose gates are already predicates.
 *
 * An empty library is a valid state for a future surface or a fixture and takes the `no-hook`
 * fallback. It must still parse because "absent" and "broken" have to look different.
 */
export declare function loadLibrary(input: LoadLibraryInput): Library;
/** The library file's raw records, for hashing/export without parsed-predicate decoration. */
export declare function rawLibrary(value: unknown): RawHook[];
//# sourceMappingURL=load.d.ts.map