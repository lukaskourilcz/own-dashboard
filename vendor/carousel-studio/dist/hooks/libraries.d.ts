import type { Library, Surface } from "./schema.js";
/**
 * The libraries sit beside the engine, not inside `src`.
 *
 * `src/hooks/` and `dist/hooks/` are both two levels under the package root, so one relative path
 * resolves the same whether the studio is consumed as TypeScript source (which `site` does, because
 * webpack applies the `.js`→`.ts` alias) or as built output.
 */
export declare const HOOKS_ROOT: string;
export interface LibraryFiles {
    readonly hooks: string;
    readonly research: string;
}
/**
 * Where each surface's committed hook and research files live.
 *
 * The absent-file behavior remains deliberate for forward-compatible new surfaces and fixtures:
 * absence loads as an empty library, while malformed or mismatched files fail loudly.
 */
export declare const LIBRARY_FILES: Readonly<Record<Surface, LibraryFiles>>;
/** One surface's library, parsed and gated. An absent file is an empty library, not a failure. */
export declare function readLibrary(surface: Surface, root?: string): Promise<Library>;
/** The library file's bytes as written, for stable hashing and inspection. */
export declare function readLibrarySource(surface: Surface, root?: string): Promise<string>;
//# sourceMappingURL=libraries.d.ts.map