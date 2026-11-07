import { readFileSync } from "node:fs";
import path from "node:path";
import { BRAND_KITS_DIRECTORY, brandKitVentures, logotypeForBrand, logotypeMarkup, readBrandKit, type BrandKitManifest, type LogotypeVariant } from "./brand-kit.js";
import { FONT_FAMILIES } from "./fonts.js";
import type { BrandTokens, CarouselTemplate } from "./schema.js";

/**
 * A kitted brand's look, resolved from its brand kit and from nowhere else.
 *
 * A brand whose tokens name a `kit` is drawn in the kit's carousel palette and faces, flattened as
 * the kit's spec asks, on the ground the kit gives each slide's position, with the kit's corner
 * mark. When the kit is missing, fails its hashes or does not set a carousel palette, nothing is
 * drawn for that brand: the old palette and wordmark are exactly what the owner replaced, and a
 * card in them would ship looking finished.
 *
 * Looks (`brand-kits/<kit>/looks/<id>.json`) layer on top, in this precedence: a ground from
 * `groundSequence` replaces the palette per slide position, as before; a look replaces the kit's
 * base palette, faces and flags; the kit's base is what a render without a look draws. Grounds and
 * corner marks stay kit-level. A look can set `flat` or `squareCorners` and never clear them.
 */

type Palette = Readonly<Record<string, string>>;

export interface KitCornerMark {
  variants: readonly LogotypeVariant[];
  widthPx: number;
  marginPx: number;
  storyTopPx: number;
}

/** One named look of a kit, resolved against the kit's own flags. */
export interface KitLook {
  id: string;
  label: string;
  purpose: string;
  palette: Palette;
  fonts: BrandTokens["fonts"];
  /** Resolved: the kit's flag or the look's, whichever is set. */
  flat: boolean;
  squareCorners: boolean;
  /** The look's placement when set, else the kit's. */
  logo: "every-slide" | "last-slide";
  /** Every colour this look's palette draws. */
  colours: ReadonlySet<string>;
}

export interface KitStyle {
  venture: string;
  displayName: string;
  palette: Palette;
  fonts: BrandTokens["fonts"] | null;
  flat: boolean;
  squareCorners: boolean;
  logo: "every-slide" | "last-slide";
  grounds: ReadonlyMap<string, Palette>;
  groundSequence: readonly string[];
  cornerMark: KitCornerMark | null;
  /** Every colour the kit declares: its palettes, its grounds, its looks, its files' inks and its neutrals. */
  colours: ReadonlySet<string>;
  /** The kit's looks by id, in manifest order. Empty for a kit that declares none. */
  looks: ReadonlyMap<string, KitLook>;
  /** The look a render uses when none is asked for; null when the kit declares none. */
  defaultLook: string | null;
}

/** A slide's place in the deck it ships in. */
export interface DeckPosition {
  index: number;
  count: number;
}

function paletteValues(palette: NonNullable<BrandKitManifest["carouselPalette"]>): Palette {
  return Object.fromEntries(Object.entries(palette).map(([token, entry]) => [token, entry.value]));
}

/** Read and verify one kit into the style the renderer draws. Throws with the kit's problems. */
export function readKitStyle(venture: string, root?: string): KitStyle {
  const reading = readBrandKit(venture, root);
  const { manifest, problems } = reading;
  if (!manifest || problems.length) throw new Error(`Brand kit ${venture} is unusable: ${problems.join("; ")}`);
  if (!manifest.carouselPalette) throw new Error(`Brand kit ${venture} sets no carousel palette, so nothing may be drawn from it`);
  const style = manifest.carouselStyle;
  const markFor = (role: string): LogotypeVariant => {
    const asset = manifest.assets.find((candidate) => candidate.role === role)!;
    return {
      role: asset.role,
      viewBox: asset.viewBox!,
      grounds: asset.grounds,
      onPhoto: asset.onPhoto,
      inks: asset.inks,
      markup: logotypeMarkup(readFileSync(path.join(reading.directory, asset.file), "utf8"))
    };
  };
  const grounds = new Map((style?.grounds ?? []).map((ground) => [ground.id, paletteValues(ground.palette)] as const));
  const flat = style?.flat ?? false;
  const squareCorners = style?.squareCorners ?? false;
  const logo = style?.logo ?? "every-slide";
  const looks = new Map(reading.looks.map((look) => {
    for (const family of [look.fonts.headline.family, look.fonts.body.family, look.fonts.mono.family]) {
      if (!FONT_FAMILIES.includes(family)) throw new Error(`Brand kit ${venture} look ${look.id} names a family the studio does not ship: ${family}`);
    }
    const palette = paletteValues(look.palette);
    const resolved: KitLook = {
      id: look.id,
      label: look.label,
      purpose: look.purpose,
      palette,
      fonts: { headline: look.fonts.headline.family, body: look.fonts.body.family, mono: look.fonts.mono.family },
      flat: flat || (look.style.flat ?? false),
      squareCorners: squareCorners || (look.style.squareCorners ?? false),
      logo: look.style.logo ?? logo,
      colours: new Set(Object.values(palette))
    };
    return [look.id, resolved] as const;
  }));
  const colours = new Set<string>([
    ...[...looks.values()].flatMap((look) => [...look.colours]),
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
    flat,
    squareCorners,
    logo,
    grounds,
    groundSequence: style?.groundSequence ?? [],
    cornerMark: style?.cornerMark
      ? { variants: style.cornerMark.roles.map(markFor), widthPx: style.cornerMark.widthPx, marginPx: style.cornerMark.marginPx, storyTopPx: style.cornerMark.storyTopPx }
      : null,
    colours,
    looks,
    defaultLook: manifest.carouselLooks?.default ?? null
  };
}

const dressedStyles = new WeakMap<KitStyle, Map<string, KitStyle>>();

/**
 * The kit style as one of its looks dresses it. The style itself when no look is asked for, so a
 * caller that passes nothing receives the object it received before looks existed. Throws for a
 * look the kit does not declare, and for a look asked of a brand that has no kit.
 */
export function kitStyleWithLook(style: KitStyle, look?: string): KitStyle;
export function kitStyleWithLook(style: KitStyle | null, look?: string): KitStyle | null;
export function kitStyleWithLook(style: KitStyle | null, look?: string): KitStyle | null {
  if (look === undefined) return style;
  if (!style) throw new Error(`Look ${look} was asked of a brand that names no brand kit`);
  const found = style.looks.get(look);
  if (!found) throw new Error(`Brand kit ${style.venture} declares no look ${look}${style.looks.size ? `; it has ${[...style.looks.keys()].join(", ")}` : ""}`);
  const cache = dressedStyles.get(style) ?? new Map<string, KitStyle>();
  dressedStyles.set(style, cache);
  const cached = cache.get(look);
  if (cached) return cached;
  const dressed: KitStyle = {
    ...style,
    palette: found.palette,
    fonts: found.fonts,
    flat: found.flat,
    squareCorners: found.squareCorners,
    logo: found.logo
  };
  cache.set(look, dressed);
  return dressed;
}

/** Every family any look of the kit binds, de-duplicated, for the coverage gates. */
export function kitLookFamilies(style: KitStyle): string[] {
  return [...new Set([...style.looks.values()].flatMap((look) => [look.fonts.headline, look.fonts.body, look.fonts.mono]))];
}

const styleCache = new Map<string, KitStyle>();

/**
 * The kit style for a brand, or null for a brand that names no kit.
 *
 * Read once per process. Throws for a brand that names a kit it cannot use, and for a brand that
 * names none while a kit claims it: that is a brand drawn in a look its venture replaced.
 */
export function kitStyleFor(brand: Pick<BrandTokens, "id" | "kit">): KitStyle | null {
  if (!brand.kit) {
    const claimant = kitClaiming(brand.id);
    if (claimant) throw new Error(`Brand kit ${claimant} dresses ${brand.id}, but the ${brand.id} tokens do not name it`);
    return null;
  }
  const cached = styleCache.get(brand.kit);
  if (cached) return cached;
  const style = readKitStyle(brand.kit);
  const reading = readBrandKit(brand.kit);
  if (reading.manifest?.studioBrand !== brand.id) {
    throw new Error(`Brand kit ${brand.kit} dresses ${reading.manifest?.studioBrand}, not ${brand.id}`);
  }
  styleCache.set(brand.kit, style);
  return style;
}

const claimCache = new Map<string, string | null>();

/** The kit whose manifest names this studio brand, read without verifying it. */
function kitClaiming(studioBrand: string): string | null {
  if (claimCache.has(studioBrand)) return claimCache.get(studioBrand)!;
  let found: string | null = null;
  for (const venture of brandKitVentures()) {
    try {
      const raw = JSON.parse(readFileSync(path.join(BRAND_KITS_DIRECTORY, venture, "manifest.json"), "utf8")) as { studioBrand?: unknown };
      if (raw.studioBrand === studioBrand) found = venture;
    } catch {
      // No manifest yet: a pending kit claims nothing.
    }
  }
  claimCache.set(studioBrand, found);
  return found;
}

/** The brand as the kit dresses it: the kit's palette and, when it sets them, its faces. */
export function dressBrand(brand: BrandTokens, style: KitStyle): BrandTokens {
  return { ...brand, colors: { ...style.palette }, fonts: style.fonts ?? brand.fonts };
}

/**
 * The ground a slide stands on, by its place in the deck. First and last keep the sequence's own;
 * the slides between walk its middle in order. Null when the kit sets no sequence.
 */
export function groundAt(style: KitStyle, position: DeckPosition): string | null {
  const sequence = style.groundSequence;
  if (sequence.length === 0) return null;
  if (position.count === sequence.length) return sequence[position.index]!;
  if (position.index === 0) return sequence[0]!;
  if (position.index === position.count - 1) return sequence.at(-1)!;
  const middle = sequence.slice(1, -1);
  return middle.length === 0 ? sequence[0]! : middle[(position.index - 1) % middle.length]!;
}

/** The brand on one ground: the ground's seven tokens in place of the kit's base palette. */
export function brandOnGround(brand: BrandTokens, style: KitStyle, ground: string): BrandTokens {
  const palette = style.grounds.get(ground);
  if (!palette) throw new Error(`Brand kit ${style.venture} has no ground ${ground}`);
  return { ...brand, colors: { ...palette } };
}

/** Whether a logotype may be drawn on this slide of the deck. */
export function logoAllowedAt(style: KitStyle | null, position: DeckPosition): boolean {
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
export function kitTemplate(template: CarouselTemplate, style: KitStyle): CarouselTemplate {
  if (!style.flat && !style.squareCorners) return template;
  return {
    ...template,
    slides: template.slides.map((slide) => ({
      ...slide,
      layers: slide.layers.flatMap((layer): CarouselTemplate["slides"][number]["layers"] => {
        if (style.flat && layer.type === "mesh") return [];
        if (style.flat && layer.type === "text" && layer.glow) return [{ ...layer, glow: false }];
        if (style.flat && layer.type === "image" && layer.scrim === "bottom") return [{ ...layer, scrim: "full" }];
        if (style.flat && layer.type === "linear-gradient") {
          const [from, to] = layer.stops;
          const seam = (from.offset + to.offset) / 2;
          return [{ ...layer, stops: [{ ...from, offset: seam }, { ...to, offset: seam }] }];
        }
        if (style.squareCorners && layer.type === "shape" && layer.radius !== 0) return [{ ...layer, radius: 0 }];
        return [layer];
      })
    }))
  };
}

/** Test seam: forget every kit read in this process. */
export function forgetKitStyles(): void {
  styleCache.clear();
  claimCache.clear();
}

/**
 * Why a brand cannot be drawn from its kit, or null when it can. For a room to ask before it spends
 * anything: the same checks the renderer makes, answered as a sentence instead of a throw.
 */
export function brandKitProblem(brand: Pick<BrandTokens, "id" | "kit">): string | null {
  try {
    const style = kitStyleFor(brand);
    if (style && !logotypeForBrand(brand.id)) return `Brand kit ${style.venture} marks no logotype file for the logo slot`;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
