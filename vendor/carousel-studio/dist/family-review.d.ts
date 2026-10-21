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
import { type DeckFamily } from "./designs.js";
/** The checklist a record was gated against. A new checklist gets a new version, not a new field. */
export declare const LAYOUT_CHECKLIST_VERSION = "layout-gate/1";
export declare const FamilySignOffSchema: z.ZodObject<{
    reviewer: z.ZodLiteral<"owner">;
    reviewedAt: z.ZodString;
    note: z.ZodString;
}, z.core.$strip>;
export declare const FamilyReviewSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-layout-review/1">;
    family: z.ZodEnum<{
        offset: "offset";
        dossier: "dossier";
        masthead: "masthead";
        gutter: "gutter";
        bevel: "bevel";
        porthole: "porthole";
        slab: "slab";
        terrace: "terrace";
        figure: "figure";
        pull: "pull";
        tower: "tower";
        billboard: "billboard";
        broadsheet: "broadsheet";
        zurich: "zurich";
        concrete: "concrete";
        terminal: "terminal";
        marginalia: "marginalia";
        memo: "memo";
        versus: "versus";
        tally: "tally";
        counterweight: "counterweight";
        throughline: "throughline";
        quiet: "quiet";
        apex: "apex";
        rail: "rail";
        vista: "vista";
        fault: "fault";
        halo: "halo";
        folio: "folio";
        press: "press";
    }>;
    templateVersion: z.ZodString;
    checklistVersion: z.ZodLiteral<"layout-gate/1">;
    composer: z.ZodString;
    specimen: z.ZodString;
    gatedAt: z.ZodString;
    signOff: z.ZodNullable<z.ZodObject<{
        reviewer: z.ZodLiteral<"owner">;
        reviewedAt: z.ZodString;
        note: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type FamilySignOff = z.infer<typeof FamilySignOffSchema>;
export type FamilyReview = z.infer<typeof FamilyReviewSchema>;
/** The module a family's composition lives in, or null when no composer map claims it. */
export declare function familyComposer(family: DeckFamily): string | null;
/** The generated specimen page for a family, relative to the repository root. */
export declare function familySpecimen(family: DeckFamily): string;
/**
 * Every family's review record.
 *
 * The `Record<DeckFamily, …>` annotation on `RECORDED` is the gate: a thirty-first family fails to
 * compile until somebody writes its record, and writing the record is the moment they have to
 * decide whether anybody has looked at the thing.
 */
export declare const FAMILY_REVIEWS: Readonly<Record<DeckFamily, FamilyReview>>;
//# sourceMappingURL=family-review.d.ts.map