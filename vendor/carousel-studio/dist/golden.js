/**
 * The golden render: one pinned 1080 × 1350 deck per family, hashed and committed.
 *
 * ## Why hashes and not PNGs
 *
 * The rasteriser is deterministic by construction — `rasterise()` runs resvg with
 * `loadSystemFonts: false` and an explicit list of the thirty committed faces, so the machine is
 * not part of the answer — and `tehdejsi-determinism.test.ts` already pins a literal sha256 for
 * one kit to prove it. This generalises that receipt to the shared families.
 *
 * Because the bytes are identical rather than approximately identical, a sha256 comparison is a
 * strictly stronger check than a pixel differ with an anti-aliasing tolerance, and it costs
 * nothing to store. The source issue names odiff; odiff earns its keep when two renders are only
 * meant to be *nearly* equal, which is not the case here, and it would add a per-platform native
 * binary downloaded at install to every CI run. The one thing a differ buys that a hash does not
 * is showing a human *what* moved — so the verdict carries `changedSlides`, and the CLI writes
 * those slides out to a gitignored folder for someone to open.
 *
 * The same reasoning settled an earlier question the other way: `orchestrator/src/studio/lifecycle.ts`
 * carries an explicit decision against persisting renders, because eighteen PNGs per accepted
 * template version were stored and nothing ever read them. A hash is read every run.
 *
 * ## Why the input is frozen this hard
 *
 * A golden render is only evidence if nothing about it can drift. So: no `typeScale`, no
 * `phaseSeed`, no photo treatment, no images, one brand, one canvas, one deck length, and a Czech
 * payload written out in full below rather than generated. Every one of those is an axis the
 * recipe engine varies; a baseline that varied with them would re-record itself into agreement.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { DECK_FAMILIES } from "./designs.js";
import { familyDeckTemplate, familyTemplateId } from "./families.js";
import { CAROUSEL_BRANDS, articleSlideSlot } from "./library.js";
import { renderCarouselPng } from "./renderer.js";
import { MASTER_CANVAS, MASTER_FORMAT } from "./canvas.js";
/** The brand the baseline is rendered in. One, because thirty families times nine brands is a suite. */
export const GOLDEN_BRAND = "mma-files";
/** Seven slides: the queue's own maximum, and the length every other gate exercises. */
export const GOLDEN_SLIDE_COUNT = 7;
/** Where the committed manifest lives, resolved from this module so `src/` and `dist/` agree. */
export const GOLDEN_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "golden");
/** The committed manifest's path. */
export const GOLDEN_MANIFEST_PATH = path.join(GOLDEN_DIRECTORY, "manifest.json");
/**
 * The frozen payload, written out rather than generated.
 *
 * Czech because every venture this studio serves publishes in Czech or renders Czech diacritics,
 * and because Czech is the wrapping worst case the fitter is tuned against. The sentences are
 * invented and say so — a baseline is not a place for a real article.
 */
const GOLDEN_STRINGS = [
    "Smyšlená zpráva otevírá zlatý otisk a drží jednu myšlenku.",
    "Druhý snímek nese delší českou větu s diakritikou: příliš žluťoučký kůň úpěl ďábelské ódy.",
    "Třetí snímek zkouší krátkou řádku.",
    "Čtvrtý snímek popisuje smyšlený důsledek, který se nikdy nestal a nikoho nepopisuje.",
    "Pátý snímek drží střední délku a jeden vlastní název: Ostrava.",
    "Šestý snímek vrací rytmus zpět k jedné větě.",
    "Poslední snímek zavírá otisk a nežádá nic."
];
/** The payload every golden render is drawn with. */
export function goldenPayload() {
    return {
        locale: "cs",
        strings: Object.fromEntries(GOLDEN_STRINGS.map((value, index) => [articleSlideSlot(index), value]))
    };
}
/** The payload as one hash, so a manifest can say which words it was built from. */
export function goldenPayloadHash() {
    return createHash("sha256").update(JSON.stringify(goldenPayload())).digest("hex");
}
/** Everything one golden render needs, with every varying axis left at its default. */
export function goldenRenderInput(family) {
    return {
        template: familyDeckTemplate(family, GOLDEN_SLIDE_COUNT),
        payload: goldenPayload(),
        brand: CAROUSEL_BRANDS[GOLDEN_BRAND],
        format: MASTER_FORMAT
    };
}
/** Rasterise one family's golden deck and hash it. */
export async function goldenDeck(family) {
    const input = goldenRenderInput(family);
    const rendered = await renderCarouselPng(input);
    const slideHashes = rendered.map(({ pngHash }) => pngHash);
    return {
        family,
        templateId: input.template.id,
        version: input.template.version,
        slideHashes,
        deckHash: createHash("sha256").update(slideHashes.join("")).digest("hex")
    };
}
export const GoldenEntrySchema = z.object({
    /*
     * A plain string, not the `DeckFamily` enum.
     *
     * A family that is retired from `DECK_FAMILIES` would make the committed manifest unparseable,
     * and an unparseable baseline fails as a thrown JSON error rather than as the thing that
     * actually happened. `strandedGoldenEntries` names it instead.
     */
    family: z.string().min(1),
    templateId: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    slideHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).length(GOLDEN_SLIDE_COUNT),
    deckHash: z.string().regex(/^[0-9a-f]{64}$/)
});
export const GoldenManifestSchema = z.object({
    schemaVersion: z.literal("carousel-golden/1"),
    canvas: z.object({ width: z.literal(MASTER_CANVAS.width), height: z.literal(MASTER_CANVAS.height) }),
    brand: z.literal(GOLDEN_BRAND),
    slideCount: z.literal(GOLDEN_SLIDE_COUNT),
    payloadHash: z.string().regex(/^[0-9a-f]{64}$/),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    entries: z.array(GoldenEntrySchema).min(1)
});
/** Rasterise every family and build the manifest the CLI writes. */
export async function buildGoldenManifest(updatedAt) {
    const entries = [];
    for (const family of DECK_FAMILIES)
        entries.push(await goldenDeck(family));
    return GoldenManifestSchema.parse({
        schemaVersion: "carousel-golden/1",
        canvas: { width: MASTER_CANVAS.width, height: MASTER_CANVAS.height },
        brand: GOLDEN_BRAND,
        slideCount: GOLDEN_SLIDE_COUNT,
        payloadHash: goldenPayloadHash(),
        updatedAt,
        entries
    });
}
/** The committed manifest. Throws rather than returning a default: a missing baseline is a failure. */
export function readGoldenManifest() {
    return GoldenManifestSchema.parse(JSON.parse(readFileSync(GOLDEN_MANIFEST_PATH, "utf8")));
}
/**
 * Re-render every family and compare it with the manifest.
 *
 * Reports every family rather than stopping at the first mismatch, because a change in a shared
 * primitive moves many families at once and a reviewer needs to see that it did.
 */
export async function verifyGoldenManifest(manifest = readGoldenManifest()) {
    const byFamily = new Map(manifest.entries.map((entry) => [entry.family, entry]));
    const verdicts = [];
    for (const family of DECK_FAMILIES) {
        const current = await goldenDeck(family);
        const expected = byFamily.get(family);
        const changedSlides = expected
            ? current.slideHashes.flatMap((hash, index) => hash === expected.slideHashes[index] ? [] : [index])
            : current.slideHashes.map((_, index) => index);
        verdicts.push({
            family,
            ok: expected !== undefined && expected.deckHash === current.deckHash,
            expected: expected?.deckHash ?? null,
            actual: current.deckHash,
            changedSlides
        });
    }
    return verdicts;
}
/** Families present in the manifest that `DECK_FAMILIES` no longer registers. */
export function strandedGoldenEntries(manifest) {
    const registered = new Set(DECK_FAMILIES);
    return manifest.entries.map(({ family }) => family).filter((family) => !registered.has(family));
}
/** The template id a family's golden entry must carry, for a manifest that names the wrong deck. */
export function goldenTemplateId(family) {
    return familyTemplateId(family, GOLDEN_SLIDE_COUNT);
}
//# sourceMappingURL=golden.js.map