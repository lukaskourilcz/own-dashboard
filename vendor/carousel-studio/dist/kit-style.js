import { readFileSync } from "node:fs";
import path from "node:path";
import { BRAND_KITS_DIRECTORY, brandKitVentures, logotypeForBrand, logotypeMarkup, readBrandKit } from "./brand-kit.js";
function paletteValues(palette) {
    return Object.fromEntries(Object.entries(palette).map(([token, entry]) => [token, entry.value]));
}
/** Read and verify one kit into the style the renderer draws. Throws with the kit's problems. */
export function readKitStyle(venture, root) {
    const reading = readBrandKit(venture, root);
    const { manifest, problems } = reading;
    if (!manifest || problems.length)
        throw new Error(`Brand kit ${venture} is unusable: ${problems.join("; ")}`);
    if (!manifest.carouselPalette)
        throw new Error(`Brand kit ${venture} sets no carousel palette, so nothing may be drawn from it`);
    const style = manifest.carouselStyle;
    const markFor = (role) => {
        const asset = manifest.assets.find((candidate) => candidate.role === role);
        return {
            role: asset.role,
            viewBox: asset.viewBox,
            grounds: asset.grounds,
            onPhoto: asset.onPhoto,
            inks: asset.inks,
            markup: logotypeMarkup(readFileSync(path.join(reading.directory, asset.file), "utf8"))
        };
    };
    const grounds = new Map((style?.grounds ?? []).map((ground) => [ground.id, paletteValues(ground.palette)]));
    const colours = new Set([
        ...Object.values(paletteValues(manifest.carouselPalette)),
        ...[...grounds.values()].flatMap((palette) => Object.values(palette)),
        ...manifest.palettes.flatMap((palette) => [...palette.grounds, ...palette.colors.map((colour) => colour.value)]),
        ...manifest.assets.flatMap((asset) => asset.inks),
        ...(style?.neutrals ?? [])
    ]);
    return {
        venture: manifest.venture,
        displayName: manifest.displayName,
        palette: paletteValues(manifest.carouselPalette),
        fonts: manifest.carouselFonts
            ? { headline: manifest.carouselFonts.headline.family, body: manifest.carouselFonts.body.family, mono: manifest.carouselFonts.mono.family }
            : null,
        flat: style?.flat ?? false,
        squareCorners: style?.squareCorners ?? false,
        logo: style?.logo ?? "every-slide",
        grounds,
        groundSequence: style?.groundSequence ?? [],
        cornerMark: style?.cornerMark
            ? { variants: style.cornerMark.roles.map(markFor), widthPx: style.cornerMark.widthPx, marginPx: style.cornerMark.marginPx, storyTopPx: style.cornerMark.storyTopPx }
            : null,
        colours
    };
}
const styleCache = new Map();
/**
 * The kit style for a brand, or null for a brand that names no kit.
 *
 * Read once per process. Throws for a brand that names a kit it cannot use, and for a brand that
 * names none while a kit claims it: that is a brand drawn in a look its venture replaced.
 */
export function kitStyleFor(brand) {
    if (!brand.kit) {
        const claimant = kitClaiming(brand.id);
        if (claimant)
            throw new Error(`Brand kit ${claimant} dresses ${brand.id}, but the ${brand.id} tokens do not name it`);
        return null;
    }
    const cached = styleCache.get(brand.kit);
    if (cached)
        return cached;
    const style = readKitStyle(brand.kit);
    const reading = readBrandKit(brand.kit);
    if (reading.manifest?.studioBrand !== brand.id) {
        throw new Error(`Brand kit ${brand.kit} dresses ${reading.manifest?.studioBrand}, not ${brand.id}`);
    }
    styleCache.set(brand.kit, style);
    return style;
}
const claimCache = new Map();
/** The kit whose manifest names this studio brand, read without verifying it. */
function kitClaiming(studioBrand) {
    if (claimCache.has(studioBrand))
        return claimCache.get(studioBrand);
    let found = null;
    for (const venture of brandKitVentures()) {
        try {
            const raw = JSON.parse(readFileSync(path.join(BRAND_KITS_DIRECTORY, venture, "manifest.json"), "utf8"));
            if (raw.studioBrand === studioBrand)
                found = venture;
        }
        catch {
            // No manifest yet: a pending kit claims nothing.
        }
    }
    claimCache.set(studioBrand, found);
    return found;
}
/** The brand as the kit dresses it: the kit's palette and, when it sets them, its faces. */
export function dressBrand(brand, style) {
    return { ...brand, colors: { ...style.palette }, fonts: style.fonts ?? brand.fonts };
}
/**
 * The ground a slide stands on, by its place in the deck. First and last keep the sequence's own;
 * the slides between walk its middle in order. Null when the kit sets no sequence.
 */
export function groundAt(style, position) {
    const sequence = style.groundSequence;
    if (sequence.length === 0)
        return null;
    if (position.count === sequence.length)
        return sequence[position.index];
    if (position.index === 0)
        return sequence[0];
    if (position.index === position.count - 1)
        return sequence.at(-1);
    const middle = sequence.slice(1, -1);
    return middle.length === 0 ? sequence[0] : middle[(position.index - 1) % middle.length];
}
/** The brand on one ground: the ground's seven tokens in place of the kit's base palette. */
export function brandOnGround(brand, style, ground) {
    const palette = style.grounds.get(ground);
    if (!palette)
        throw new Error(`Brand kit ${style.venture} has no ground ${ground}`);
    return { ...brand, colors: { ...palette } };
}
/** Whether a logotype may be drawn on this slide of the deck. */
export function logoAllowedAt(style, position) {
    return style?.logo !== "last-slide" || position.index === position.count - 1;
}
/**
 * The template as the kit's spec allows it to be drawn.
 *
 * Flat removes what a flat spec forbids and keeps what it does not: a mesh backdrop is a blur of
 * gradients and goes; glow goes; a photograph's fading scrim becomes an even one; a two-stop seam
 * keeps its geometry with its stops pulled to one offset, so it draws two flat grounds and never a
 * blend. Square corners zero every panel's radius. Validation and drawing both read the result, so
 * the contrast gates measure the slide that is drawn.
 */
export function kitTemplate(template, style) {
    if (!style.flat && !style.squareCorners)
        return template;
    return {
        ...template,
        slides: template.slides.map((slide) => ({
            ...slide,
            layers: slide.layers.flatMap((layer) => {
                if (style.flat && layer.type === "mesh")
                    return [];
                if (style.flat && layer.type === "text" && layer.glow)
                    return [{ ...layer, glow: false }];
                if (style.flat && layer.type === "image" && layer.scrim === "bottom")
                    return [{ ...layer, scrim: "full" }];
                if (style.flat && layer.type === "linear-gradient") {
                    const [from, to] = layer.stops;
                    const seam = (from.offset + to.offset) / 2;
                    return [{ ...layer, stops: [{ ...from, offset: seam }, { ...to, offset: seam }] }];
                }
                if (style.squareCorners && layer.type === "shape" && layer.radius !== 0)
                    return [{ ...layer, radius: 0 }];
                return [layer];
            })
        }))
    };
}
/** Test seam: forget every kit read in this process. */
export function forgetKitStyles() {
    styleCache.clear();
    claimCache.clear();
}
/**
 * Why a brand cannot be drawn from its kit, or null when it can. For a room to ask before it spends
 * anything: the same checks the renderer makes, answered as a sentence instead of a throw.
 */
export function brandKitProblem(brand) {
    try {
        const style = kitStyleFor(brand);
        if (style && !logotypeForBrand(brand.id))
            return `Brand kit ${style.venture} marks no logotype file for the logo slot`;
        return null;
    }
    catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}
//# sourceMappingURL=kit-style.js.map