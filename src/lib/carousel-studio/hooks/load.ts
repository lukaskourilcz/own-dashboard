import {
  HookResearchSchema,
  RawLibrarySchema,
  ResearchFileSchema,
  TIER_B_PREDICATES,
  VOCABULARIES,
  type Hook,
  type Library,
  type Predicate,
  type RawHook,
  type Surface
} from "./schema.js";

/** A load-time failure that names the hook and the surface, because both are needed to fix it. */
export class HookLoadError extends Error {
  constructor(
    readonly surface: Surface,
    readonly hookId: string,
    detail: string
  ) {
    super(`${surface} hook "${hookId}": ${detail}`);
    this.name = "HookLoadError";
  }
}

/**
 * `"difficultyAtLeast:3"` → `{ kind: "difficultyAtLeast", level: 3 }`.
 *
 * Everything this rejects, it rejects loudly. An unknown predicate cannot fall through to "no
 * condition" — that would promote a typo into an always-eligible hook, which is the one direction
 * this must never fail in — and it cannot fall through to "never eligible" either, because a hook
 * that silently stops rendering is a bug nobody sees until the pool starves.
 */
export function parsePredicate(surface: Surface, hookId: string, raw: string): Predicate {
  const separator = raw.indexOf(":");
  const name = separator < 0 ? raw : raw.slice(0, separator);
  const argument = separator < 0 ? null : raw.slice(separator + 1);

  const spec = VOCABULARIES[surface][name];
  if (!spec) {
    const tierB = (TIER_B_PREDICATES as readonly string[]).includes(name);
    throw new HookLoadError(
      surface,
      hookId,
      tierB
        ? `"${name}" is a Tier B predicate and is not built yet — see docs/hooks/04-schema-and-gates.md and its open issue`
        : `"${name}" is not in the ${surface} predicate vocabulary (${Object.keys(VOCABULARIES[surface]).sort().join(", ")})`
    );
  }

  if (spec.arity === "none") {
    if (argument !== null) {
      throw new HookLoadError(surface, hookId, `"${name}" takes no argument, received "${argument}"`);
    }
    return { kind: name } as Predicate;
  }

  if (argument === null || argument.length === 0) {
    throw new HookLoadError(surface, hookId, `"${name}" needs a ${spec.arity} argument, written "${name}:<value>"`);
  }

  if (spec.arity === "number") {
    // Number("3x") is NaN but Number("") is 0 and Number(" 3 ") is 3, so the shape is checked
    // before the conversion rather than after it.
    if (!/^\d+$/u.test(argument)) {
      throw new HookLoadError(surface, hookId, `"${name}" needs a whole number, received "${argument}"`);
    }
    return { kind: name, [spec.field!]: Number(argument) } as Predicate;
  }

  return { kind: name, [spec.field!]: argument } as Predicate;
}

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
export function loadLibrary(input: LoadLibraryInput): Library {
  const raw = RawLibrarySchema.parse(input.hooks);
  const research = ResearchFileSchema.parse(input.research);

  const researchById = new Map(research.map((entry) => [entry.id, entry]));
  const seen = new Set<string>();
  const hooks: Hook[] = [];

  for (const hook of raw) {
    if (seen.has(hook.id)) {
      throw new HookLoadError(input.surface, hook.id, "duplicate id in the library");
    }
    seen.add(hook.id);

    const entry = researchById.get(hook.id);
    if (!entry) {
      throw new HookLoadError(input.surface, hook.id, "has no entry in the research file");
    }

    hooks.push({
      id: hook.id,
      cooldownDays: hook.cooldownDays,
      surface: input.surface,
      truthRequires: hook.truthRequires.map((requirement) =>
        parsePredicate(input.surface, hook.id, requirement)),
      rawRequires: hook.truthRequires,
      variants: hook.variants,
      research: HookResearchSchema.parse(entry)
    });
  }

  // Research without a hook is the same defect seen from the other side: a prediction nobody is
  // testing, or a hook that was deleted and left its record behind.
  for (const entry of research) {
    if (!seen.has(entry.id)) {
      throw new HookLoadError(input.surface, entry.id, "has a research entry but no hook in the library");
    }
  }

  return { surface: input.surface, hooks };
}

/** The library file's raw records, for hashing/export without parsed-predicate decoration. */
export function rawLibrary(value: unknown): RawHook[] {
  return RawLibrarySchema.parse(value);
}
