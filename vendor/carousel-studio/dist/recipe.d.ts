import { z } from "zod";
import { type DeckDesign, type DeckFamily } from "./designs.js";
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
export declare const TYPE_SCALES: readonly [0.9, 1, 1.1];
export type TypeScale = (typeof TYPE_SCALES)[number];
export declare const CarouselRecipeSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-recipe/1">;
    venture: z.ZodEnum<{
        "caught-up": "caught-up";
        "mma-files": "mma-files";
        kvorum: "kvorum";
        booksofhistory: "booksofhistory";
        "door-money": "door-money";
        "tehdejsi-svet": "tehdejsi-svet";
    }>;
    slug: z.ZodString;
    date: z.ZodString;
    family: z.ZodEnum<{
        offset: "offset";
        mesh: "mesh";
        contrast: "contrast";
        dossier: "dossier";
        editorial: "editorial";
        spotlight: "spotlight";
        aurora: "aurora";
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
    variant: z.ZodEnum<{
        B: "B";
        A: "A";
    }>;
    accentSwap: z.ZodBoolean;
    treatment: z.ZodEnum<{
        mono: "mono";
        none: "none";
        duotone: "duotone";
    }>;
    typeScale: z.ZodUnion<readonly [z.ZodLiteral<0.9>, z.ZodLiteral<1>, z.ZodLiteral<1.1>]>;
    phaseSeed: z.ZodNumber;
}, z.core.$strip>;
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
export declare function recipeSeed(input: {
    venture: string;
    slug: string;
    date: string;
}): string;
/**
 * Which family this article gets.
 *
 * Seeded, then adjusted against what the venture actually shipped: never one of the last two
 * families, and preferring the third of the rotation that has gone longest unused. The memory is
 * the venture's own receipts — recorded state, not a clock — so a replay of last Tuesday reads
 * last Tuesday's history and lands on last Tuesday's family.
 */
export declare function chooseFamily(seed: string, history: readonly RecipeHistoryEntry[], hasHero?: boolean): DeckFamily;
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
export declare function deriveRecipe(inputs: RecipeInputs, history?: readonly RecipeHistoryEntry[]): CarouselRecipe;
/**
 * The template id a recipe resolves to.
 *
 * The canonical family template — scale 1, phase 0 — keeps the plain `deck-<family>-<count>` id
 * the eager library and every stored pack already name. Anything else carries its two axes in the
 * id, so a reference still names exactly one byte stream and `templateByReference` can rebuild it
 * without a lookup table that would have to hold seven hundred entries.
 */
export declare function recipeTemplateId(recipe: Pick<CarouselRecipe, "family" | "typeScale" | "phaseSeed">, slideCount: number): string;
/** The reverse: an id back into the axes that built it, or null when it is not one of ours. */
export declare function parseRecipeTemplateId(id: string): {
    design: DeckDesign;
    slideCount: number;
    typeScale: TypeScale;
    phaseSeed: number;
} | null;
/** The template a recipe describes, built rather than looked up. */
export declare function recipeTemplate(recipe: Pick<CarouselRecipe, "family" | "typeScale" | "phaseSeed" | "treatment">, slideCount: number): CarouselTemplate;
/** The variant string the renderer takes, or none where the design declares no second rendering. */
export declare function recipeVariant(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap">): "A" | "B" | undefined;
/**
 * A recipe as one URL segment.
 *
 * The deck route used to take a bare style name, which is all a design was. A design is now six
 * fields, and a preview that shows anything less than the whole of it is showing the owner a
 * picture the pipeline would not ship. Compact and lowercase, because it is a path segment.
 */
export declare function encodeRecipe(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed">): string;
export declare function decodeRecipe(token: string): Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed"> | null;
/** The one line the workspace shows above the controls, in the owner's own language. */
export declare function recipeLine(recipe: Pick<CarouselRecipe, "family" | "variant" | "accentSwap" | "treatment" | "typeScale" | "phaseSeed">): string;
/**
 * A design the owner saved and wants used again.
 *
 * A recipe answers "what does *this* article look like". A preset answers "what should this
 * venture look like", which is the question the engine has been answering out of its own built-in
 * axes. Presets go live through the same explicit owner action as a template's lifecycle, and for
 * the same reason: something the pipeline will apply unattended, to work nobody has seen yet,
 * should be turned on deliberately rather than by having been typed.
 */
export declare const CarouselPresetSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    ventureScope: z.ZodArray<z.ZodEnum<{
        "caught-up": "caught-up";
        "mma-files": "mma-files";
        kvorum: "kvorum";
        booksofhistory: "booksofhistory";
        "door-money": "door-money";
        "tehdejsi-svet": "tehdejsi-svet";
    }>>;
    formats: z.ZodArray<z.ZodEnum<{
        "instagram-square": "instagram-square";
        "instagram-portrait": "instagram-portrait";
        "instagram-story": "instagram-story";
        threads: "threads";
    }>>;
    family: z.ZodEnum<{
        offset: "offset";
        mesh: "mesh";
        contrast: "contrast";
        dossier: "dossier";
        editorial: "editorial";
        spotlight: "spotlight";
        aurora: "aurora";
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
    variant: z.ZodEnum<{
        B: "B";
        A: "A";
    }>;
    accentSwap: z.ZodBoolean;
    treatment: z.ZodEnum<{
        mono: "mono";
        none: "none";
        duotone: "duotone";
    }>;
    typeScale: z.ZodUnion<readonly [z.ZodLiteral<0.9>, z.ZodLiteral<1>, z.ZodLiteral<1.1>]>;
    status: z.ZodEnum<{
        draft: "draft";
        live: "live";
    }>;
    changedAt: z.ZodString;
    changedBy: z.ZodLiteral<"owner">;
}, z.core.$strip>;
export type CarouselPreset = z.infer<typeof CarouselPresetSchema>;
export declare const CarouselPresetFileSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-preset/1">;
    presets: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        ventureScope: z.ZodArray<z.ZodEnum<{
            "caught-up": "caught-up";
            "mma-files": "mma-files";
            kvorum: "kvorum";
            booksofhistory: "booksofhistory";
            "door-money": "door-money";
            "tehdejsi-svet": "tehdejsi-svet";
        }>>;
        formats: z.ZodArray<z.ZodEnum<{
            "instagram-square": "instagram-square";
            "instagram-portrait": "instagram-portrait";
            "instagram-story": "instagram-story";
            threads: "threads";
        }>>;
        family: z.ZodEnum<{
            offset: "offset";
            mesh: "mesh";
            contrast: "contrast";
            dossier: "dossier";
            editorial: "editorial";
            spotlight: "spotlight";
            aurora: "aurora";
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
        variant: z.ZodEnum<{
            B: "B";
            A: "A";
        }>;
        accentSwap: z.ZodBoolean;
        treatment: z.ZodEnum<{
            mono: "mono";
            none: "none";
            duotone: "duotone";
        }>;
        typeScale: z.ZodUnion<readonly [z.ZodLiteral<0.9>, z.ZodLiteral<1>, z.ZodLiteral<1.1>]>;
        status: z.ZodEnum<{
            draft: "draft";
            live: "live";
        }>;
        changedAt: z.ZodString;
        changedBy: z.ZodLiteral<"owner">;
    }, z.core.$strip>>;
    updatedAt: z.ZodString;
}, z.core.$strip>;
export type CarouselPresetFile = z.infer<typeof CarouselPresetFileSchema>;
/**
 * The presets a venture's derivation may draw from.
 *
 * Live only. A draft is a design the owner is still looking at, and a tool that quietly started
 * shipping it would make "draft" mean nothing — the same reason a draft template cannot be
 * referenced by a pack.
 */
export declare function livePresetsFor(presets: readonly CarouselPreset[], venture: CarouselSummaryVenture): CarouselPreset[];
//# sourceMappingURL=recipe.d.ts.map