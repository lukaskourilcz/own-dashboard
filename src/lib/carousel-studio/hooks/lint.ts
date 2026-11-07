import { loadLibrary, HookLoadError } from "./load.js";
import { VERTICALS, type Hook, type Predicate, type Surface } from "./schema.js";

/**
 * The craft caps from `docs/hooks/02-hook-craft-rules.md`, restated as numbers a check applies.
 *
 * They live here rather than in the doc alone for the reason the marketingShark gates give: a cap
 * the playbook asks for and no check enforces is a suggestion.
 */
export const HOOK_LIMITS = {
  enChars: 58,
  csChars: 66,
  /** CS may be longer than its EN sibling — parity of punch, not of word count — but not by much. */
  csRatio: 1.25,
  /** Von Restorff at rotation level: no template may become wallpaper. */
  archetypeShare: 0.2,
  /** Pool arithmetic: a gate a selector relies on must not collapse to one or two hooks. */
  minHooksPerGate: 5
} as const;

export type FindingLevel = "error" | "warning";

export interface Finding {
  readonly level: FindingLevel;
  readonly rule: string;
  readonly surface: Surface;
  /** Absent for library-wide findings such as the archetype cap. */
  readonly hookId?: string;
  readonly detail: string;
}

/**
 * `everyday-blindspot`'s Czech dev line, the one allow-listed declension exception.
 *
 * "Používáš {topic} každý den" puts the token in the accusative slot, which the rule forbids. It is
 * kept because the category values that fill it are indeclinable technical nouns in Czech register
 * ("Používáš JavaScript každý den" is what a Czech developer says), and because the alternative
 * frames lose the IoED setup that is the whole hook. The exception is one string, named here rather
 * than expressed as a looser rule, so the rule stays strict for everything written after it.
 */
const DECLENSION_EXCEPTIONS: ReadonlySet<string> = new Set(["everyday-blindspot:dev"]);

const TOKEN = /\{[a-z]+\}/giu;

function charCount(value: string): number {
  // Code points, not UTF-16 units: the budget is about how long the line reads, and Czech
  // diacritics must not each cost two.
  return Array.from(value).length;
}

/**
 * Is this `{topic}` occurrence in a slot Czech declension survives?
 *
 * Safe slots are sentence subject — the start of the string or the start of a new sentence — and
 * immediately after a colon. Both leave the token in the nominative, which is the case the values
 * are supplied in. Anything else ("s {topic}", "Používáš {topic}") demands a case the renderer
 * cannot produce.
 */
function tokenSlotIsSafe(text: string, index: number): boolean {
  const before = text.slice(0, index);
  if (before.trim().length === 0) return true;
  if (/:\s*$/u.test(before)) return true;
  return /[.!?]\s+$/u.test(before);
}

function pushCharFindings(findings: Finding[], surface: Surface, hook: Hook): void {
  for (const vertical of VERTICALS) {
    const variant = hook.variants[vertical];
    const en = charCount(variant.en);
    const cs = charCount(variant.cs);

    if (en > HOOK_LIMITS.enChars) {
      findings.push({ level: "error", rule: "char-budget-en", surface, hookId: hook.id, detail: `${vertical}.en is ${en} characters, cap is ${HOOK_LIMITS.enChars}` });
    }
    if (cs > HOOK_LIMITS.csChars) {
      findings.push({ level: "error", rule: "char-budget-cs", surface, hookId: hook.id, detail: `${vertical}.cs is ${cs} characters, cap is ${HOOK_LIMITS.csChars}` });
    }
    if (cs > en * HOOK_LIMITS.csRatio) {
      findings.push({ level: "error", rule: "char-budget-ratio", surface, hookId: hook.id, detail: `${vertical}.cs is ${(cs / en).toFixed(2)}x its EN sibling (${cs} vs ${en}), cap is ${HOOK_LIMITS.csRatio}x` });
    }
  }
}

function pushDeclensionFindings(findings: Finding[], surface: Surface, hook: Hook): void {
  for (const vertical of VERTICALS) {
    const variant = hook.variants[vertical];
    if (DECLENSION_EXCEPTIONS.has(`${hook.id}:${vertical}`)) continue;

    for (const match of variant.cs.matchAll(TOKEN)) {
      if (!tokenSlotIsSafe(variant.cs, match.index)) {
        findings.push({
          level: "error",
          rule: "declension-slot",
          surface,
          hookId: hook.id,
          detail: `${vertical}.cs puts ${match[0]} outside a declension-safe slot; it may only be the sentence subject or follow a colon`
        });
      }
    }
  }
}

/** Does gate `given` guarantee gate `required` holds? The monotone reading of the pool arithmetic. */
function implies(given: Predicate, required: Predicate): boolean {
  if (required.kind === "always") return true;
  if (given.kind !== required.kind) return false;
  switch (required.kind) {
    case "difficultyAtLeast":
      return (given as typeof required).level >= required.level;
    case "optionsAtLeast":
      // An exact count also satisfies an at-least gate of the same size or smaller.
      return given.kind === "optionsExactly"
        ? given.count >= required.count
        : (given as typeof required).count >= required.count;
    case "optionsExactly":
      return given.kind === "optionsExactly" && given.count === required.count;
    case "categoryIn":
      return (given as typeof required).list === required.list;
    case "questionStartsWith":
      return (given as typeof required).prefix === required.prefix;
    default:
      return true;
  }
}

/**
 * How many hooks are servable on a question that satisfies one gate.
 *
 * Not "how many hooks name this gate" — that reading fails `difficultyAtLeast:4`, which four hooks
 * name, while a d4 question is actually served by twenty-five of them. `docs/hooks/03` defines the
 * servable pool as the always pool plus every hook whose gates the question satisfies, and
 * difficulty and option counts are monotone: a d4 question satisfies `difficultyAtLeast:2`.
 */
function poolFor(hooks: readonly Hook[], gate: Predicate): Hook[] {
  return hooks.filter((hook) =>
    hook.truthRequires.every((requirement) => implies(gate, requirement)));
}

function pushPoolFindings(findings: Finding[], surface: Surface, hooks: readonly Hook[]): void {
  const seen = new Map<string, Predicate>();
  for (const hook of hooks) {
    for (const [index, predicate] of hook.truthRequires.entries()) {
      seen.set(hook.rawRequires[index]!, predicate);
    }
  }
  for (const [raw, gate] of [...seen].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const pool = poolFor(hooks, gate);
    if (pool.length < HOOK_LIMITS.minHooksPerGate) {
      findings.push({
        level: "error",
        rule: "pool-starvation",
        surface,
        detail: `gate ${raw} is served by ${pool.length} hook(s), floor is ${HOOK_LIMITS.minHooksPerGate}`
      });
    }
  }
}

function pushArchetypeFindings(findings: Finding[], surface: Surface, hooks: readonly Hook[]): void {
  if (hooks.length === 0) return;
  const counts = new Map<string, number>();
  for (const hook of hooks) {
    counts.set(hook.research.archetype, (counts.get(hook.research.archetype) ?? 0) + 1);
  }
  for (const [archetype, count] of [...counts].sort(([left], [right]) => (left < right ? -1 : 1))) {
    const share = count / hooks.length;
    if (share > HOOK_LIMITS.archetypeShare) {
      findings.push({
        level: "error",
        rule: "archetype-cap",
        surface,
        detail: `archetype "${archetype}" is ${count} of ${hooks.length} hooks (${(share * 100).toFixed(1)}%), cap is ${HOOK_LIMITS.archetypeShare * 100}%`
      });
    }
  }
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
export function lintLibrary(input: LintInput): Finding[] {
  const findings: Finding[] = [];

  let library;
  try {
    library = loadLibrary(input);
  } catch (error) {
    if (error instanceof HookLoadError) {
      return [{ level: "error", rule: "load", surface: error.surface, hookId: error.hookId, detail: error.message.split(": ").slice(1).join(": ") }];
    }
    return [{ level: "error", rule: "load", surface: input.surface, detail: error instanceof Error ? error.message : String(error) }];
  }

  for (const hook of library.hooks) {
    pushCharFindings(findings, input.surface, hook);
    pushDeclensionFindings(findings, input.surface, hook);
  }
  pushArchetypeFindings(findings, input.surface, library.hooks);
  pushPoolFindings(findings, input.surface, library.hooks);

  return findings;
}

export function hasErrors(findings: readonly Finding[]): boolean {
  return findings.some((finding) => finding.level === "error");
}

export function formatFindings(findings: readonly Finding[]): string {
  return findings
    .map((finding) => {
      const where = finding.hookId ? `${finding.surface}/${finding.hookId}` : finding.surface;
      return `${finding.level === "error" ? "ERROR" : "warn "} [${finding.rule}] ${where}: ${finding.detail}`;
    })
    .join("\n");
}
