import { readFile } from "node:fs/promises";
import path from "node:path";
import { HOOKS_ROOT, LIBRARY_FILES } from "./libraries.js";
import { formatFindings, hasErrors, lintLibrary, type Finding } from "./lint.js";
import { SURFACES, type Surface } from "./schema.js";

async function readJsonOrEmpty(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

export async function lintAllLibraries(root = HOOKS_ROOT): Promise<{
  findings: Finding[];
  counts: Record<Surface, number>;
}> {
  const findings: Finding[] = [];
  const counts = {} as Record<Surface, number>;

  for (const surface of SURFACES) {
    const files = LIBRARY_FILES[surface];
    const hooks = await readJsonOrEmpty(path.join(root, files.hooks));
    const research = await readJsonOrEmpty(path.join(root, files.research));
    counts[surface] = Array.isArray(hooks) ? hooks.length : 0;
    findings.push(...lintLibrary({ surface, hooks, research }));
  }

  return { findings, counts };
}

async function main(): Promise<void> {
  const { findings, counts } = await lintAllLibraries();

  for (const surface of SURFACES) {
    const state = counts[surface] === 0 ? "empty (not authored yet)" : `${counts[surface]} hooks`;
    process.stdout.write(`${surface.padEnd(5)} ${state}\n`);
  }

  if (findings.length > 0) {
    process.stdout.write(`\n${formatFindings(findings)}\n`);
  }

  const errors = findings.filter((finding) => finding.level === "error").length;
  const warnings = findings.length - errors;
  process.stdout.write(`\n${errors} error(s), ${warnings} warning(s)\n`);

  if (hasErrors(findings)) process.exitCode = 1;
}

// Only when run as a script, so the module stays importable from tests.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
