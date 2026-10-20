import { z } from "zod";
import { type DeckFamily } from "./designs.js";
import { type CarouselRenderInput } from "./renderer.js";
/** The brand the baseline is rendered in. One, because thirty families times nine brands is a suite. */
export declare const GOLDEN_BRAND: "mma-files";
/** Seven slides: the queue's own maximum, and the length every other gate exercises. */
export declare const GOLDEN_SLIDE_COUNT = 7;
/** Where the committed manifest lives, resolved from this module so `src/` and `dist/` agree. */
export declare const GOLDEN_DIRECTORY: string;
/** The committed manifest's path. */
export declare const GOLDEN_MANIFEST_PATH: string;
/** The payload every golden render is drawn with. */
export declare function goldenPayload(): CarouselRenderInput["payload"];
/** The payload as one hash, so a manifest can say which words it was built from. */
export declare function goldenPayloadHash(): string;
/** Everything one golden render needs, with every varying axis left at its default. */
export declare function goldenRenderInput(family: DeckFamily): CarouselRenderInput;
export interface GoldenDeck {
    family: DeckFamily;
    templateId: string;
    version: string;
    /** One sha256 per rasterised slide, in deck order. */
    slideHashes: string[];
    /** The slide hashes as one hash, which is what a manifest comparison reads first. */
    deckHash: string;
}
/** Rasterise one family's golden deck and hash it. */
export declare function goldenDeck(family: DeckFamily): Promise<GoldenDeck>;
export declare const GoldenEntrySchema: z.ZodObject<{
    family: z.ZodString;
    templateId: z.ZodString;
    version: z.ZodString;
    slideHashes: z.ZodArray<z.ZodString>;
    deckHash: z.ZodString;
}, z.core.$strip>;
export declare const GoldenManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-golden/1">;
    canvas: z.ZodObject<{
        width: z.ZodLiteral<1080>;
        height: z.ZodLiteral<1350>;
    }, z.core.$strip>;
    brand: z.ZodLiteral<"mma-files">;
    slideCount: z.ZodLiteral<7>;
    payloadHash: z.ZodString;
    updatedAt: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        family: z.ZodString;
        templateId: z.ZodString;
        version: z.ZodString;
        slideHashes: z.ZodArray<z.ZodString>;
        deckHash: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type GoldenManifest = z.infer<typeof GoldenManifestSchema>;
/** Rasterise every family and build the manifest the CLI writes. */
export declare function buildGoldenManifest(updatedAt: string): Promise<GoldenManifest>;
/** The committed manifest. Throws rather than returning a default: a missing baseline is a failure. */
export declare function readGoldenManifest(): GoldenManifest;
export interface GoldenVerdict {
    family: DeckFamily;
    ok: boolean;
    expected: string | null;
    actual: string;
    /** Which slides differ, by deck index, when the deck hashes disagree. */
    changedSlides: number[];
}
/**
 * Re-render every family and compare it with the manifest.
 *
 * Reports every family rather than stopping at the first mismatch, because a change in a shared
 * primitive moves many families at once and a reviewer needs to see that it did.
 */
export declare function verifyGoldenManifest(manifest?: GoldenManifest): Promise<GoldenVerdict[]>;
/** Families present in the manifest that `DECK_FAMILIES` no longer registers. */
export declare function strandedGoldenEntries(manifest: GoldenManifest): string[];
/** The template id a family's golden entry must carry, for a manifest that names the wrong deck. */
export declare function goldenTemplateId(family: DeckFamily): string;
//# sourceMappingURL=golden.d.ts.map