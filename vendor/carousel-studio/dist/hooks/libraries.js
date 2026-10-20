import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadLibrary } from "./load.js";
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
/**
 * The libraries sit beside the engine, not inside `src`.
 *
 * `src/hooks/` and `dist/hooks/` are both two levels under the package root, so one relative path
 * resolves the same whether the studio is consumed as TypeScript source (which `site` does, because
 * webpack applies the `.js`→`.ts` alias) or as built output.
 */
export const HOOKS_ROOT = path.resolve(moduleDirectory, "../../hooks");
/**
 * Where each surface's committed hook and research files live.
 *
 * The absent-file behavior remains deliberate for forward-compatible new surfaces and fixtures:
 * absence loads as an empty library, while malformed or mismatched files fail loudly.
 */
export const LIBRARY_FILES = {
    quiz: { hooks: "quiz.hooks.json", research: "quiz.research.json" },
    news: { hooks: "news.hooks.json", research: "news.research.json" },
    mma: { hooks: "mma.hooks.json", research: "mma.research.json" }
};
async function readJsonOrEmpty(file) {
    try {
        return JSON.parse(await readFile(file, "utf8"));
    }
    catch (error) {
        if (error.code === "ENOENT")
            return [];
        throw error;
    }
}
/**
 * Where a library file is, spelled so a bundler can follow it.
 *
 * `root` is a parameter because the tests point it at a fixture directory, and a bundler cannot
 * prove what a parameter holds. Turbopack answers that by tracing the entire project into every
 * function that can reach this call — measured, that took the home page's traced payload from 251
 * files to 2,252 and doubled its size, because the tracing root is the whole repository.
 *
 * `turbopackIgnore` says: do not follow this read, the files it wants are declared instead. They
 * are — `site/next.config.ts` traces `studio/hooks/**` onto the routes that read a library, which
 * is the honest version of the same statement and covers the ones this analysis would have missed
 * anyway. The comment sits inside the call because that is where the bundler looks for it, and it
 * survives `tsc` into `dist` because comments are preserved.
 */
function libraryPath(root, file) {
    return path.join(/* turbopackIgnore: true */ root, file);
}
/** One surface's library, parsed and gated. An absent file is an empty library, not a failure. */
export async function readLibrary(surface, root = HOOKS_ROOT) {
    const files = LIBRARY_FILES[surface];
    const [hooks, research] = await Promise.all([
        readJsonOrEmpty(libraryPath(root, files.hooks)),
        readJsonOrEmpty(libraryPath(root, files.research))
    ]);
    return loadLibrary({ surface, hooks, research });
}
/** The library file's bytes as written, for stable hashing and inspection. */
export async function readLibrarySource(surface, root = HOOKS_ROOT) {
    return readFile(libraryPath(root, LIBRARY_FILES[surface].hooks), "utf8");
}
//# sourceMappingURL=libraries.js.map