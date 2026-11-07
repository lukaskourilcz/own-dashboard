import { createHash } from "node:crypto";
import { z } from "zod";
import { FAMILY_SERVES, familyDeckTemplate } from "./families.js";
import { articleDeckTemplate } from "./library.js";
import { DECK_DESIGNS, LAUNCH_FAMILIES, isDeckStyle, type DeckDesign, type DeckFamily } from "./designs.js";
import type { CarouselTemplate } from "./schema.js";
import type { CarouselSummaryVenture } from "./summary.js";

/**
 * The complete design decision for one article's social set.
 *
 * Everything that used to be implicit, decided in three different places, or not decided at all:
 * `deckStyleFor` picked one of five wallpapers from a seed, the A/B pair differed in a field the
 * renderer ignores, and the photo treatment and type scale did not exist. A recipe is one small
 * document that says what a deck looks like, is derived from the article's own identity plus what
 * the venture has recently shipped, and replays byte-identical.
 */

export const TYPE_SCALES = [0.9, 1, 1.1] as const;
export type TypeScale = (typeof TYPE_SCALES)[number];

export const CarouselRecipeSchema = z.object({
  schemaVersion: z.literal("carousel-recipe/1"),
  venture: z.enum(["caught-up", "mma-files", "kvorum", "booksofhistory", "door-money", "tehdejsi-svet"]),
  slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  family: z.enum(DECK_DESIGNS),
  variant: z.enum(["A", "B"]),
  accentSwap: z.boolean(),
  treatment: z.enum(["none", "mono", "duotone"]),
  typeScale: z.union([z.literal(0.9), z.literal(1), z.literal(1.1)]),
  /** Rotates the family's rhythm, so two articles in one family still open differently. */
  phaseSeed: z.number().int().min(0).max(3)
});

export type CarouselRecipe = z.infer<typeof CarouselRecipeSchema>;

/** A recorded render, as the anti-repeat memory reads it. Newest first. */
export interface RecipeHistoryEntry {
  date: string;
  family: string;
}

/**
 * The seed, from the article's own identity and nothing else.
 *
 * The same shape as the hook picker's: a hash of what the thing *is*, never a clock and never a
 * die. Replaying a delivery from its recorded inputs has to produce the same design, or the
 * receipt beside it proves nothing.
 */
export function recipeSeed(input: { venture: string; slug: string; date: string }): string {
  return createHash("sha256").update(`${input.venture} ${input.slug} ${input.date}`).digest("hex");
}

/** An index into `length`, taken from a slice of the seed. */
function seededIndex(seed: string, offset: number, length: number): number {
  return Number(BigInt(`0x${seed.slice(offset, offset + 8)}`) % BigInt(length));
}

/**
 * Which family this article gets.
 *
 * Seeded, then adjusted against what the venture actually shipped: never one of the last two
 * families, and preferring the third of the rotation that has gone longest unused. The memory is
 * the venture's own receipts — recorded state, not a clock — so a replay of last Tuesday reads
 * last Tuesday's history and lands on last Tuesday's family.
 */
export function chooseFamily(
  seed: string,
  history: readonly RecipeHistoryEntry[],
  hasHero?: boolean
): DeckFamily {
  const recent = new Set(history.slice(0, 2).map((entry) => entry.family));
  /*
   * The dealer deals the launch rotation, and only the launch rotation.
   *
   * Twenty-three registered families read as one grey template with the numbers filed off — the
   * owner's words on 2026-08-29 were "too basic". Five launch families replace them in the draw;
   * everything else stays registered solely so a stored recipe keeps rendering. A live preset
   * pool bypasses this function entirely, and there the owner may still name a legacy family —
   * narrowing to an explicit choice is theirs to do, widening back to grey is not.
   *
   * A photograph then decides which of the five are in the draw. Three compose for an image —
   * `FAMILY_SERVES` says so — and an article that won a licensed photograph, passed the vision
   * gate and paid for it must never be dealt a family with nowhere to put it. Only the
   * has-a-photograph direction narrows: an article without one keeps all five, because the
   * photo-forward three degrade to type perfectly well.
   */
  const serves = hasHero === true
    ? LAUNCH_FAMILIES.filter((family) => FAMILY_SERVES[family] === "photo-forward")
    : [...LAUNCH_FAMILIES];
  const eligible = serves.filter((family) => !recent.has(family));
  const pool = eligible.length > 0 ? eligible : serves;
  // How long ago each family was last used: absent from the history is longest of all. Ties break
  // on the name, so the order is total and the choice is reproducible.
  const lastUsed = new Map<string, number>();
  history.forEach((entry, position) => {
    if (!lastUsed.has(entry.family)) lastUsed.set(entry.family, position);
  });
  const ranked = [...pool].sort((left, right) => {
    const leftAge = lastUsed.get(left) ?? Number.POSITIVE_INFINITY;
    const rightAge = lastUsed.get(right) ?? Number.POSITIVE_INFINITY;
    if (leftAge !== rightAge) return rightAge - leftAge;
    return left.localeCompare(right);
  });
  const leastRecent = ranked.slice(0, Math.max(1, Math.ceil(ranked.length / 3)));
  return leastRecent[seededIndex(seed, 0, leastRecent.length)]!;
}

export interface RecipeInputs {
  venture: CarouselRecipe["venture"];
  slug: string;
  date: string;
  /** Whether the article carries a photograph. A treatment on nothing is not a design choice. */
  hasHero?: boolean;
  /**
   * The venture's live presets, when it has any.
   *
   * With a pool the engine draws whole designs the owner has approved rather than dealing its own
   * axes; the pick is still seeded by the article's identity and still refuses the last two
   * families, so a pool changes what the variety is drawn from and not that there is variety.
   */
  pool?: readonly PresetDraw[];
}

/** The part of a preset a derivation uses. */
export interface PresetDraw {
  family: DeckDesign;
  variant: "A" | "B";
  accentSwap: boolean;
  treatment: "none" | "mono" | "duotone";
  typeScale: TypeScale;
}

/**
 * A complete recipe, from the article and the venture's memory. Pure, and total.
 */
export function deriveRecipe(inputs: RecipeInputs, history: readonly RecipeHistoryEntry[] = []): CarouselRecipe {
  const seed = recipeSeed(inputs);
  const treatments = inputs.hasHero === false ? (["none"] as const) : (["none", "none", "mono", "duotone"] as const);
  const base = {
    schemaVersion: "carousel-recipe/1" as const,
    venture: inputs.venture,
    slug: inputs.slug,
    date: inputs.date,
    // The rhythm rotation is the engine's own, always: a preset says what a deck looks like, and
    // two articles in one preset still have to open on different beats.
    phaseSeed: seededIndex(seed, 32, 4)
  };
  const pool = inputs.pool?.filter((preset) => preset.family) ?? [];
  if (pool.length > 0) {
    // Anti-repeat still applies, over the pool: the last two families the venture shipped are out
    // unless the pool has nothing else to offer.
    const recent = new Set(history.slice(0, 2).map((entry) => entry.family));
    // Inside the owner's pool, the same rule as the open library: an article that brought a
    // photograph is drawn from the presets that can show one. It is a preference here rather than
    // a filter, because the pool is an explicit choice — if the owner picked five type-only
    // designs, that is the answer, and the photograph goes unused by their decision rather than
    // by an oversight in the dealer.
    const photoReady = inputs.hasHero === true
      ? pool.filter((preset) => isDeckStyle(preset.family) || FAMILY_SERVES[preset.family] === "photo-forward")
      : pool;
    const drawable = photoReady.length > 0 ? photoReady : pool;
    const eligible = drawable.filter((preset) => !recent.has(preset.family));
    const drawn = (eligible.length > 0 ? eligible : drawable)[seededIndex(seed, 0, (eligible.length > 0 ? eligible : drawable).length)]!;
    return CarouselRecipeSchema.parse({
      ...base,
      family: drawn.family,
      variant: drawn.variant,
      accentSwap: drawn.accentSwap,
      treatment: inputs.hasHero === false ? "none" : drawn.treatment,
      typeScale: drawn.typeScale
    });
  }
  return CarouselRecipeSchema.parse({
    ...base,
    family: chooseFamily(seed, history, inputs.hasHero),
    variant: "A",
    accentSwap: seededIndex(seed, 8, 2) === 1,
    treatment: treatments[seededIndex(seed, 16, treatments.length)]!,
    typeScale: TYPE_SCALES[seededIndex(seed, 24, TYPE_SCALES.length)]!
  });
}

/**
 * The template id a recipe resolves to.
 *
 * The canonical family template — scale 1, phase 0 — keeps the plain `deck-<family>-<count>` id
 * the eager library and every stored pack already name. Anything else carries its two axes in the
 * id, so a reference still names exactly one byte stream and `templateByReference` can rebuild it
 * without a lookup table that would have to hold seven hundred entries.
 */
export function recipeTemplateId(recipe: Pick<CarouselRecipe, "family" | "typeScale" | "phaseSeed">, slideCount: number): string {
  if (isDeckStyle(recipe.family)) return `deck-${recipe.family}-${slideCount}`;
  if (recipe.typeScale === 1 && recipe.phaseSeed === 0) return `deck-${recipe.family}-${slideCount}`;
  return `deck-${recipe.family}-${slideCount}-s${Math.round(recipe.typeScale * 10)}p${recipe.phaseSeed}`;
}

/** The reverse: an id back into the axes that built it, or null when it is not one of ours. */
export function parseRecipeTemplateId(id: string): { design: DeckDesign; slideCount: number; typeScale: TypeScale; phaseSeed: number } | null {
  const match = /^deck-([a-z-]+)-(\d+)(?:-s(\d+)p(\d))?$/u.exec(id);
  if (!match) return null;
  const [, design, count, scale, phase] = match;
  if (!design || !count) return null;
  if (!(DECK_DESIGNS as readonly string[]).includes(design)) return null;
  const typeScale = scale === undefined ? 1 : Number(scale) / 10;
  if (!(TYPE_SCALES as readonly number[]).includes(typeScale)) return null;
  return {
    design: design as DeckDesign,
    slideCount: Number(count),
    typeScale: typeScale as TypeScale,
    phaseSeed: phase === undefined ? 0 : Number(phase)
  };
}

/** The template a recipe describes, built rather than looked up. */
export function recipeTemplate(recipe: Pick<CarouselRecipe, "family" | "typeScale" | "phaseSeed" | "treatment">, slideCount: number): CarouselTemplate {
  if (isDeckStyle(recipe.family)) return articleDeckTemplate(slideCount, recipe.family);
  return familyDeckTemplate(recipe.family, slideCount, {
    typeScale: recipe.typeScale,
    phaseSeed: recipe.phaseSeed,
    treatment: recipe.treatment
  });
}

/** The variant string the renderer takes, or none where the design declares no second rendering. */
export function recipeVariant(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap">): "A" | "B" | undefined {
  if (isDeckStyle(recipe.family)) return undefined;
  return recipe.accentSwap ? "B" : recipe.variant;
}

/**
 * A recipe as one URL segment.
 *
 * The deck route used to take a bare style name, which is all a design was. A design is now six
 * fields, and a preview that shows anything less than the whole of it is showing the owner a
 * picture the pipeline would not ship. Compact and lowercase, because it is a path segment.
 */
export function encodeRecipe(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed">): string {
  const variant = recipe.accentSwap ? "b" : recipe.variant.toLowerCase();
  return `${recipe.family}~${variant}~${recipe.treatment}~${Math.round(recipe.typeScale * 10)}~${recipe.phaseSeed}`;
}

export function decodeRecipe(token: string): Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed"> | null {
  const parts = token.split("~");
  if (parts.length !== 5) return null;
  const [family, variant, treatment, scale, phase] = parts as [string, string, string, string, string];
  if (!(DECK_DESIGNS as readonly string[]).includes(family)) return null;
  if (variant !== "a" && variant !== "b") return null;
  if (treatment !== "none" && treatment !== "mono" && treatment !== "duotone") return null;
  const typeScale = Number(scale) / 10;
  if (!(TYPE_SCALES as readonly number[]).includes(typeScale)) return null;
  const phaseSeed = Number(phase);
  if (!Number.isInteger(phaseSeed) || phaseSeed < 0 || phaseSeed > 3) return null;
  return {
    family: family as DeckDesign,
    variant: variant === "b" ? "B" : "A",
    accentSwap: variant === "b",
    treatment,
    typeScale: typeScale as TypeScale,
    phaseSeed
  };
}

/** The one line the workspace shows above the controls, in the owner's own language. */
export function recipeLine(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed">): string {
  const treatment = { none: "bez úpravy", mono: "černobíle", duotone: "duotón" }[recipe.treatment];
  return [
    recipe.family,
    recipe.accentSwap ? "B" : recipe.variant,
    treatment,
    `${recipe.typeScale}×`,
    `fáze ${recipe.phaseSeed}`
  ].join(" · ");
}

/**
 * A design the owner saved and wants used again.
 *
 * A recipe answers "what does *this* article look like". A preset answers "what should this
 * venture look like", which is the question the engine has been answering out of its own built-in
 * axes. Presets go live through the same explicit owner action as a template's lifecycle, and for
 * the same reason: something the pipeline will apply unattended, to work nobody has seen yet,
 * should be turned on deliberately rather than by having been typed.
 */
export const CarouselPresetSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(60),
  name: z.string().trim().min(2).max(80),
  /** Which ventures may draw from it. Empty means every venture. */
  ventureScope: z.array(z.enum(["caught-up", "mma-files", "kvorum", "booksofhistory", "door-money", "tehdejsi-svet"])).max(6),
  formats: z.array(z.enum(["instagram-square", "instagram-portrait", "instagram-story", "threads"])).min(1).max(4),
  family: z.enum(DECK_DESIGNS),
  variant: z.enum(["A", "B"]),
  accentSwap: z.boolean(),
  treatment: z.enum(["none", "mono", "duotone"]),
  typeScale: z.union([z.literal(0.9), z.literal(1), z.literal(1.1)]),
  status: z.enum(["draft", "live"]),
  changedAt: z.string().min(1),
  changedBy: z.literal("owner")
});

export type CarouselPreset = z.infer<typeof CarouselPresetSchema>;

export const CarouselPresetFileSchema = z.object({
  schemaVersion: z.literal("carousel-preset/1"),
  presets: z.array(CarouselPresetSchema).max(60),
  updatedAt: z.string().min(1)
});

export type CarouselPresetFile = z.infer<typeof CarouselPresetFileSchema>;

/**
 * The presets a venture's derivation may draw from.
 *
 * Live only. A draft is a design the owner is still looking at, and a tool that quietly started
 * shipping it would make "draft" mean nothing — the same reason a draft template cannot be
 * referenced by a pack.
 */
export function livePresetsFor(presets: readonly CarouselPreset[], venture: CarouselSummaryVenture): CarouselPreset[] {
  return presets.filter((preset) =>
    // A preset can be scoped only to a venture that renders through the family system, so a
    // devShark package (quiz templates, no recipe) matches unscoped presets alone.
    preset.status === "live" && (preset.ventureScope.length === 0 || (preset.ventureScope as readonly string[]).includes(venture)));
}
