import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { HOOKS_ROOT, LIBRARY_FILES, readLibrary } from "./libraries.js";
import { buildVectors, VECTORS_FILE } from "./vectors.js";

/**
 * Regenerate the conformance vectors from the current library and evaluator.
 *
 * `--check` verifies the committed file matches instead of writing it, which is what CI runs: a
 * vector file that drifted from the evaluator pins nothing.
 */
async function main(): Promise<void> {
  const check = process.argv.includes("--check");
  const target = path.join(HOOKS_ROOT, VECTORS_FILE);

  const library = await readLibrary("quiz");
  const raw = JSON.parse(await readFile(path.join(HOOKS_ROOT, LIBRARY_FILES.quiz.hooks), "utf8"));
  const next = `${JSON.stringify(buildVectors(library, raw), null, 2)}\n`;

  if (check) {
    const current = await readFile(target, "utf8").catch(() => "");
    if (current !== next) {
      process.stdout.write(`${VECTORS_FILE} is stale — regenerate it with pnpm hooks:vectors\n`);
      process.exitCode = 1;
      return;
    }
    process.stdout.write(`${VECTORS_FILE} matches the evaluator\n`);
    return;
  }

  await writeFile(target, next, "utf8");
  process.stdout.write(`Wrote ${VECTORS_FILE}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
