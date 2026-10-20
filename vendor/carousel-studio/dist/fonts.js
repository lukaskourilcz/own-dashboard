import path from "node:path";
import { fileURLToPath } from "node:url";
import { FONT_METRICS } from "./font-metrics.generated.js";
import { lettersFor } from "./locales.js";
/**
 * The typefaces the engine ships with, and the arithmetic it measures them by.
 *
 * Two problems used to live here as one. The brands named system font stacks — `Arial Narrow,
 * Arial, sans-serif` — and no font file existed in the repository, so the render server drew in
 * whatever fontconfig happened to find and the PNG bytes were a property of the machine. And the
 * fitter charged every character a flat 0.56 em, which is about right for Czech sentence case and
 * about a fifth short for all-caps, so an uppercase headline measured as fitting and then drew
 * wider than the canvas.
 *
 * Both are answered the same way: the files are committed, they are handed to the rasteriser
 * explicitly, and their real advance widths are committed beside them. Nothing at render time
 * reads a font, asks the operating system for one, or estimates.
 */
/** Where the .ttf files live, resolved from this module so `dist/` and `src/` both find them. */
export const FONTS_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");
/** Every committed face, as absolute paths, in a stable order. */
export function fontFiles() {
    return Object.values(FONT_METRICS)
        .map((face) => path.join(FONTS_DIRECTORY, face.file))
        .sort();
}
const familySlugs = {
    Anton: "anton",
    Archivo: "archivo",
    "Barlow Condensed": "barlow-condensed",
    Barlow: "barlow",
    Petrona: "petrona",
    Karla: "karla",
    Figtree: "figtree",
    Outfit: "outfit",
    "Public Sans": "public-sans",
    "IBM Plex Sans": "ibm-plex-sans",
    "IBM Plex Mono": "ibm-plex-mono",
    // Cyrillic-complete cuts, added for a venture that publishes in Ukrainian. Every other family
    // here is Latin-only in practice, and a missing glyph does not fail — it draws a box, which is
    // the one rendering failure that looks deliberate.
    Literata: "literata",
    Inter: "inter",
    // The faces the two kitted brands' own products set (`studio/brand-kits/*/manifest.json`):
    // DNESKAi's display and reading faces, and devShark's display and code faces.
    "Space Grotesk": "space-grotesk",
    "Source Serif 4": "source-serif-4",
    Manrope: "manrope",
    "JetBrains Mono": "jetbrains-mono"
};
/** The families a brand may name. Anything else is a typo, and the schema will not catch it. */
export const FONT_FAMILIES = Object.keys(familySlugs);
const facesBySlug = (() => {
    const grouped = new Map();
    for (const [key, face] of Object.entries(FONT_METRICS)) {
        const slug = key.slice(0, key.lastIndexOf("-"));
        grouped.set(slug, [...(grouped.get(slug) ?? []), face]);
    }
    for (const faces of grouped.values())
        faces.sort((left, right) => left.weight - right.weight);
    return grouped;
})();
/**
 * The committed face closest to what a layer asked for.
 *
 * A template may name any weight from 300 to 900; a family carries the four or five the design
 * set actually uses. Rounding to the nearest committed weight — the heavier one on a tie — keeps
 * a request for 500 body text as body text, where falling through to a different family would be
 * a silent substitution of exactly the kind this whole task exists to end.
 */
export function resolveFace(family, weight) {
    const slug = familySlugs[family];
    const faces = slug ? facesBySlug.get(slug) : undefined;
    if (!faces || faces.length === 0)
        throw new Error(`No committed font for family ${family}`);
    let best = faces[0];
    for (const face of faces) {
        const better = Math.abs(face.weight - weight) < Math.abs(best.weight - weight);
        const tie = Math.abs(face.weight - weight) === Math.abs(best.weight - weight) && face.weight > best.weight;
        if (better || tie)
            best = face;
    }
    return best;
}
const advanceTables = new Map();
function advancesOf(face) {
    const cached = advanceTables.get(face);
    if (cached)
        return cached;
    const table = new Map();
    for (const [width, characters] of Object.entries(face.widths)) {
        for (const character of characters)
            table.set(character, Number(width) / 1_000);
    }
    advanceTables.set(face, table);
    return table;
}
/**
 * How wide a string sets, in em, before letter-spacing.
 *
 * Per character rather than per grapheme cluster: a combining sequence is measured as its parts,
 * which over-counts a little, and over-counting is the safe direction — it shrinks type that
 * would otherwise have run off the edge.
 */
export function measureEm(face, value) {
    const advances = advancesOf(face);
    const fallback = face.fallback / 1_000;
    let total = 0;
    for (const character of value)
        total += advances.get(character) ?? fallback;
    return total;
}
const averages = new Map();
/**
 * The mean advance of one character of a sample, in thousandths of an em.
 *
 * Only the characters the face actually carries are averaged. A character with no entry would
 * otherwise be charged the fallback, which would quietly turn "this face cannot set this
 * alphabet" into "this alphabet measures a bit differently" — a coverage failure disguised as
 * arithmetic. The word space is always in the sample, because a line is words rather than a word.
 *
 * `font-metrics.generated.ts` computes each face's `average` this way over `LATIN_LETTERS`, and
 * `script-capacity.test.ts` asserts the two agree for every committed face. That equality is what
 * keeps the generated table and this function from drifting into two different answers.
 */
export function averageAdvance(face, sample) {
    const cached = averages.get(face) ?? new Map();
    averages.set(face, cached);
    const previous = cached.get(sample);
    if (previous !== undefined)
        return previous;
    const advances = advancesOf(face);
    const widths = [...sample, " "]
        .map((character) => advances.get(character))
        .filter((advance) => advance !== undefined);
    const mean = Math.round((widths.reduce((total, advance) => total + advance, 0) * 1_000) / Math.max(1, widths.length));
    cached.set(sample, mean);
    return mean;
}
/**
 * What a capacity question should charge per character for a line set in this language.
 *
 * The Latin mean is the floor rather than the answer. Czech measures marginally *narrower* than
 * ASCII in every committed face — its accented vowels are the narrow ones — and lowering a
 * declared slot limit's headroom on that basis would be a loosening dressed up as precision. A
 * language that measures wider raises the charge; one that measures narrower does not lower it.
 */
export function capacityAverage(face, locale) {
    return Math.max(face.average, averageAdvance(face, lettersFor(locale)));
}
/** True only when the committed face contains the glyph; the fitter's width fallback does not count. */
export function hasCommittedGlyph(face, character) {
    return [...character].length === 1 && advancesOf(face).has(character);
}
/** Stable, de-duplicated list of characters that would otherwise fall back during rasterisation. */
export function missingCommittedGlyphs(face, value) {
    return [...new Set([...value].filter((character) => !hasCommittedGlyph(face, character)))];
}
//# sourceMappingURL=fonts.js.map