import { type LogotypeVariant } from "./brand-kit.js";
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
/** Read and verify one kit into the style the renderer draws. Throws with the kit's problems. */
export declare function readKitStyle(venture: string, root?: string): KitStyle;
/**
 * The kit style as one of its looks dresses it. The style itself when no look is asked for, so a
 * caller that passes nothing receives the object it received before looks existed. Throws for a
 * look the kit does not declare, and for a look asked of a brand that has no kit.
 */
export declare function kitStyleWithLook(style: KitStyle, look?: string): KitStyle;
export declare function kitStyleWithLook(style: KitStyle | null, look?: string): KitStyle | null;
/** Every family any look of the kit binds, de-duplicated, for the coverage gates. */
export declare function kitLookFamilies(style: KitStyle): string[];
/**
 * The kit style for a brand, or null for a brand that names no kit.
 *
 * Read once per process. Throws for a brand that names a kit it cannot use, and for a brand that
 * names none while a kit claims it: that is a brand drawn in a look its venture replaced.
 */
export declare function kitStyleFor(brand: Pick<BrandTokens, "id" | "kit">): KitStyle | null;
/** The brand as the kit dresses it: the kit's palette and, when it sets them, its faces. */
export declare function dressBrand(brand: BrandTokens, style: KitStyle): BrandTokens;
/**
 * The ground a slide stands on, by its place in the deck. First and last keep the sequence's own;
 * the slides between walk its middle in order. Null when the kit sets no sequence.
 */
export declare function groundAt(style: KitStyle, position: DeckPosition): string | null;
/** The brand on one ground: the ground's seven tokens in place of the kit's base palette. */
export declare function brandOnGround(brand: BrandTokens, style: KitStyle, ground: string): BrandTokens;
/** Whether a logotype may be drawn on this slide of the deck. */
export declare function logoAllowedAt(style: KitStyle | null, position: DeckPosition): boolean;
/**
 * The template as the kit's spec allows it to be drawn.
 *
 * Flat removes what a flat spec forbids and keeps what it does not: a mesh backdrop is a blur of
 * gradients and goes; glow goes; a photograph's fading scrim becomes an even one; a two-stop seam
 * keeps its geometry with its stops pulled to one offset, so it draws two flat grounds and never a
 * blend. Square corners zero every panel's radius. Validation and drawing both read the result, so
 * the contrast gates measure the slide that is drawn.
 */
export declare function kitTemplate(template: CarouselTemplate, style: KitStyle): CarouselTemplate;
/** Test seam: forget every kit read in this process. */
export declare function forgetKitStyles(): void;
/**
 * Why a brand cannot be drawn from its kit, or null when it can. For a room to ask before it spends
 * anything: the same checks the renderer makes, answered as a sentence instead of a throw.
 */
export declare function brandKitProblem(brand: Pick<BrandTokens, "id" | "kit">): string | null;
export {};
//# sourceMappingURL=kit-style.d.ts.map