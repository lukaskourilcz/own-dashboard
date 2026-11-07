/**
 * Who looked at each layout, and at which version — stored, so "reviewed" stops being a promise.
 *
 * ## What this registry is, and what it is not
 *
 * It is a gate. `FAMILY_REVIEWS` is annotated `Record<DeckFamily, FamilyReview>`, which is the same
 * exhaustiveness trick `FAMILY_SERVES` uses: register a name in `DECK_FAMILIES` without adding a
 * record here and `pnpm typecheck` fails before the family can be dealt. A new layout therefore
 * cannot enter the library unnoticed, which is the thing the source issue asked for.
 *
 * It is not a claim that a person has looked at anything. `signOff` is `null` on every family,
 * because no per-family owner review has been recorded in this repository and inventing one would
 * be fabricating provenance. What the gate asserts today is `gated`: every automated check passes
 * for this family at every brand and offered format, its golden deck hashes what the manifest says
 * it hashes, and the record is pinned to the composed template's own version. Those are facts a
 * machine established and can re-establish.
 *
 * The owner sign-off is the inert half. It is filled by editing this file — the reviewer, the date
 * and the words they wrote, in the commit that reviewed the layout. Nothing in the pipeline demands
 * one, because demanding one before any exists would refuse every deck. The switch that would
 * demand it was left out on purpose (#581, docs/ENGINEERING.md rule 10): a function only its own
 * test calls is dead code, so it gets written in the change that wires it into the render path.
 */
import { z } from "zod";
import { DECK_FAMILIES, type DeckFamily } from "./designs.js";
import { EDITORIAL_FAMILIES } from "./families-editorial.js";
import { FOUNDING_FAMILIES } from "./families-founding.js";
import { LAUNCH_FAMILY_SPECS } from "./families-launch.js";
import { POSTER_FAMILIES } from "./families-poster.js";
import { PRINT_FAMILIES } from "./families-print.js";
import { SYSTEM_FAMILIES } from "./families-system.js";

/** The checklist a record was gated against. A new checklist gets a new version, not a new field. */
export const LAYOUT_CHECKLIST_VERSION = "layout-gate/1";

export const FamilySignOffSchema = z.object({
  /** Only the owner signs a layout off. An agent gating one is `gated`, which is a different word. */
  reviewer: z.literal("owner"),
  reviewedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().min(3).max(240)
});

export const FamilyReviewSchema = z.object({
  schemaVersion: z.literal("carousel-layout-review/1"),
  family: z.enum(DECK_FAMILIES),
  /** The composed template version this record covers. A version bump is a new review. */
  templateVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  checklistVersion: z.literal(LAYOUT_CHECKLIST_VERSION),
  /** The module that composes this family, so the record points at what it is about. */
  composer: z.string().min(1),
  /** The generated page a human actually looks at. */
  specimen: z.string().min(1),
  /** The day the automated gate first covered this family. */
  gatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  signOff: FamilySignOffSchema.nullable()
});

export type FamilySignOff = z.infer<typeof FamilySignOffSchema>;
export type FamilyReview = z.infer<typeof FamilyReviewSchema>;

/**
 * Which file composes which family, read off the composer maps rather than typed out again.
 *
 * Hand-written it would be thirty strings that nobody updates when a composition moves between
 * modules — and a record that points at the wrong file is worse than one that points nowhere.
 */
const COMPOSER_MODULES: ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]> = [
  ["studio/src/families-founding.ts", FOUNDING_FAMILIES],
  ["studio/src/families-poster.ts", POSTER_FAMILIES],
  ["studio/src/families-print.ts", PRINT_FAMILIES],
  ["studio/src/families-system.ts", SYSTEM_FAMILIES],
  ["studio/src/families-launch.ts", LAUNCH_FAMILY_SPECS],
  ["studio/src/families-editorial.ts", EDITORIAL_FAMILIES]
];

/** The module a family's composition lives in, or null when no composer map claims it. */
export function familyComposer(family: DeckFamily): string | null {
  return COMPOSER_MODULES.find(([, families]) => family in families)?.[0] ?? null;
}

/** The generated specimen page for a family, relative to the repository root. */
export function familySpecimen(family: DeckFamily): string {
  return `docs/design-lab/families/${family}.html`;
}

/**
 * The hand-kept half of each record: the version it covers, when it was gated, and any sign-off.
 *
 * Every family entered the gate on the day the gate was built, so every `gatedAt` is that day.
 * That is the honest date and not a backfill of when each composition was written — the gate did
 * not exist then and cannot claim to have run.
 */
const RECORDED: Readonly<Record<DeckFamily, { templateVersion: string; gatedAt: string; signOff: FamilySignOff | null }>> = {
  masthead: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  gutter: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  bevel: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  porthole: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  slab: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  terrace: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  figure: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  pull: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  tower: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  dossier: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  billboard: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  broadsheet: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  zurich: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  concrete: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  terminal: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  marginalia: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  memo: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  versus: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  tally: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  counterweight: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  throughline: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  quiet: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  offset: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  apex: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  rail: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  vista: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  fault: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  halo: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  folio: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null },
  press: { templateVersion: "1.0.0", gatedAt: "2026-09-16", signOff: null }
};

/**
 * Every family's review record.
 *
 * The `Record<DeckFamily, …>` annotation on `RECORDED` is the gate: a thirty-first family fails to
 * compile until somebody writes its record, and writing the record is the moment they have to
 * decide whether anybody has looked at the thing.
 */
export const FAMILY_REVIEWS: Readonly<Record<DeckFamily, FamilyReview>> = Object.freeze(
  Object.fromEntries(DECK_FAMILIES.map((family) => {
    const recorded = RECORDED[family];
    return [family, Object.freeze({
      schemaVersion: "carousel-layout-review/1",
      family,
      templateVersion: recorded.templateVersion,
      checklistVersion: LAYOUT_CHECKLIST_VERSION,
      composer: familyComposer(family) ?? "unregistered",
      specimen: familySpecimen(family),
      gatedAt: recorded.gatedAt,
      signOff: recorded.signOff
    } satisfies FamilyReview)];
  })) as Record<DeckFamily, FamilyReview>
);
