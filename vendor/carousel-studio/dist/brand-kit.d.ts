import { z } from "zod";
/**
 * A venture's approved brand kit: the logo files and the rules that come with them.
 *
 * One directory per venture under `studio/brand-kits/<venture>/`, holding the production files
 * exactly as the venture's own repository ships them and a `manifest.json` that says what each
 * file is for. The files are copied byte for byte and the manifest pins each one by sha256, so a
 * kit here is a receipt for a specific approved commit rather than a redrawing of it.
 *
 * The renderer reads a kit only for its logotype: the files the manifest marks `logoSlot` replace
 * the wordmark the studio used to set in a font. Everything else in the manifest (marks, icons,
 * share cards, clear space, do-nots, social rules) is for the people and agents making posts, and
 * the admin Design Lab shows it. Adding a venture's kit is dropping in its files and one manifest;
 * no code names a venture.
 */
/** Where the kits live, resolved from this module so `dist/` and `src/` both find them. */
export declare const BRAND_KITS_DIRECTORY: string;
/**
 * What kind of drawing an asset is. `logotype` and `lockup` are the name (a lockup adds a symbol),
 * `mark` is a symbol alone, `icon` a favicon or app tile, `share-card` a ready Open Graph image.
 */
export declare const BrandKitAssetKindSchema: z.ZodEnum<{
    logotype: "logotype";
    lockup: "lockup";
    mark: "mark";
    icon: "icon";
    "share-card": "share-card";
}>;
export declare const BrandKitManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"brand-kit/1">;
    venture: z.ZodString;
    studioBrand: z.ZodString;
    displayName: z.ZodString;
    status: z.ZodLiteral<"approved">;
    approvedOn: z.ZodISODate;
    source: z.ZodDiscriminatedUnion<[z.ZodObject<{
        kind: z.ZodLiteral<"repository">;
        repository: z.ZodString;
        ref: z.ZodString;
        commit: z.ZodString;
        documents: z.ZodArray<z.ZodString>;
    }, z.core.$strict>, z.ZodObject<{
        kind: z.ZodLiteral<"handoff">;
        receivedOn: z.ZodISODate;
        from: z.ZodString;
        description: z.ZodString;
        pinTo: z.ZodString;
        documents: z.ZodArray<z.ZodString>;
    }, z.core.$strict>], "kind">;
    logotype: z.ZodObject<{
        viewBox: z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>;
        aspectRatio: z.ZodNumber;
        outlined: z.ZodLiteral<true>;
        clearSpace: z.ZodObject<{
            ratioOfHeight: z.ZodOptional<z.ZodNumber>;
            basis: z.ZodString;
        }, z.core.$strict>;
        minimumHeightPx: z.ZodOptional<z.ZodNumber>;
        sizes: z.ZodArray<z.ZodObject<{
            place: z.ZodString;
            size: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    palettes: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        label: z.ZodString;
        grounds: z.ZodArray<z.ZodString>;
        colors: z.ZodArray<z.ZodObject<{
            role: z.ZodString;
            value: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>>;
    carouselPalette: z.ZodOptional<z.ZodObject<{
        background: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        surface: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        "surface-strong": z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        foreground: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        muted: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        accent: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        secondary: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    carouselFonts: z.ZodOptional<z.ZodObject<{
        headline: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        body: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        mono: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>>;
    carouselStyle: z.ZodOptional<z.ZodObject<{
        flat: z.ZodBoolean;
        squareCorners: z.ZodDefault<z.ZodBoolean>;
        logo: z.ZodDefault<z.ZodEnum<{
            "every-slide": "every-slide";
            "last-slide": "last-slide";
        }>>;
        grounds: z.ZodDefault<z.ZodArray<z.ZodObject<{
            id: z.ZodString;
            label: z.ZodString;
            palette: z.ZodObject<{
                background: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                surface: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                "surface-strong": z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                foreground: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                muted: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                accent: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
                secondary: z.ZodObject<{
                    value: z.ZodString;
                    source: z.ZodString;
                }, z.core.$strict>;
            }, z.core.$strict>;
        }, z.core.$strict>>>;
        groundSequence: z.ZodDefault<z.ZodArray<z.ZodString>>;
        cornerMark: z.ZodOptional<z.ZodObject<{
            roles: z.ZodArray<z.ZodString>;
            widthPx: z.ZodNumber;
            marginPx: z.ZodNumber;
            storyTopPx: z.ZodNumber;
        }, z.core.$strict>>;
        neutrals: z.ZodDefault<z.ZodArray<z.ZodString>>;
    }, z.core.$strict>>;
    carouselLooks: z.ZodOptional<z.ZodObject<{
        default: z.ZodString;
        ids: z.ZodArray<z.ZodString>;
    }, z.core.$strict>>;
    rules: z.ZodArray<z.ZodString>;
    doNots: z.ZodArray<z.ZodString>;
    socialRules: z.ZodDefault<z.ZodArray<z.ZodString>>;
    typography: z.ZodArray<z.ZodString>;
    assets: z.ZodArray<z.ZodObject<{
        role: z.ZodString;
        kind: z.ZodEnum<{
            logotype: "logotype";
            lockup: "lockup";
            mark: "mark";
            icon: "icon";
            "share-card": "share-card";
        }>;
        label: z.ZodString;
        file: z.ZodString;
        mediaType: z.ZodEnum<{
            "image/svg+xml": "image/svg+xml";
            "image/png": "image/png";
        }>;
        sha256: z.ZodString;
        bytes: z.ZodNumber;
        sourcePath: z.ZodString;
        use: z.ZodString;
        grounds: z.ZodDefault<z.ZodArray<z.ZodString>>;
        onPhoto: z.ZodDefault<z.ZodBoolean>;
        inks: z.ZodArray<z.ZodString>;
        viewBox: z.ZodOptional<z.ZodTuple<[z.ZodNumber, z.ZodNumber, z.ZodNumber, z.ZodNumber], null>>;
        minimumSize: z.ZodOptional<z.ZodString>;
        pixels: z.ZodOptional<z.ZodObject<{
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strict>>;
        logoSlot: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type BrandKitManifest = z.infer<typeof BrandKitManifestSchema>;
export type BrandKitAsset = BrandKitManifest["assets"][number];
/**
 * One named look of a kit (`looks/<id>.json`): a full carousel palette, the three type slots and
 * the style flags the look sets. A studio file format, not a published contract.
 */
export declare const CarouselLookSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"brand-kit-look/1">;
    id: z.ZodString;
    label: z.ZodString;
    purpose: z.ZodString;
    palette: z.ZodObject<{
        background: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        surface: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        "surface-strong": z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        foreground: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        muted: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        accent: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        secondary: z.ZodObject<{
            value: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    fonts: z.ZodObject<{
        headline: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        body: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
        mono: z.ZodObject<{
            family: z.ZodString;
            source: z.ZodString;
        }, z.core.$strict>;
    }, z.core.$strict>;
    style: z.ZodDefault<z.ZodObject<{
        flat: z.ZodOptional<z.ZodBoolean>;
        squareCorners: z.ZodOptional<z.ZodBoolean>;
        logo: z.ZodOptional<z.ZodEnum<{
            "every-slide": "every-slide";
            "last-slide": "last-slide";
        }>>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type CarouselLook = z.infer<typeof CarouselLookSchema>;
/** The directory inside a kit that holds its look files. */
export declare const BRAND_KIT_LOOKS_DIRECTORY = "looks";
/** What reading one kit directory found. A problem is a reason the kit cannot be used as it is. */
export interface BrandKitReading {
    directory: string;
    manifest: BrandKitManifest | null;
    /** The parsed look files in manifest order. Empty when the manifest lists none or any failed. */
    looks: CarouselLook[];
    problems: string[];
}
/**
 * Read and verify one kit: the manifest parses, its venture matches its directory, and every
 * file it names exists with the recorded size and hash.
 *
 * Never throws. A missing or damaged kit is reported, because the admin shows it as unavailable
 * and the renderer refuses to draw from it, and those are two different reactions to one fact.
 */
export declare function readBrandKit(venture: string, root?: string): BrandKitReading;
/** Every kit directory, in name order. A directory without a manifest is still listed. */
export declare function brandKitVentures(root?: string): string[];
export declare function readBrandKits(root?: string): BrandKitReading[];
/** One colouring of the logotype, ready to draw. */
export interface LogotypeVariant {
    role: string;
    viewBox: readonly [number, number, number, number];
    grounds: readonly string[];
    onPhoto: boolean;
    inks: readonly string[];
    /** The file's drawing with its root element, title and metadata removed. Ids are `LOGO_ID`-prefixed. */
    markup: string;
}
export interface KitLogotype {
    venture: string;
    displayName: string;
    clearSpace: number;
    minimumHeightPx: number;
    /** The files the manifest lets fill the logo slot, in its order: the preference order. */
    variants: readonly LogotypeVariant[];
}
/** A placeholder every id and `url(#…)` in logo markup carries, replaced with a per-layer id. */
export declare const LOGO_ID = "__logo__";
/**
 * The drawable part of an SVG file.
 *
 * Only what a nested `<svg>` needs: the root element, `<title>` and `<metadata>` (the provenance
 * manifest the design tool embedded) are dropped, and ids are namespaced so two logos on one
 * slide, or a logo and a gradient, cannot share one. Anything scripted or external is refused
 * rather than stripped, because a kit that needs stripping is not the approved file.
 */
export declare function logotypeMarkup(svg: string): string;
/**
 * The logotype a kit hands the renderer: null when the kit lets nothing fill the logo slot, and an
 * error naming why when the kit cannot be used.
 */
export declare function kitLogotype(reading: BrandKitReading): KitLogotype | null;
/**
 * The logotype for a studio brand, or null when no kit dresses that brand.
 *
 * Read once per process. A kit that exists but fails verification throws: drawing the old
 * wordmark instead would ship a card in an identity the venture has replaced, and nothing would
 * say so.
 */
export declare function logotypeForBrand(studioBrand: string): KitLogotype | null;
/**
 * Which colouring of the logotype goes on these grounds.
 *
 * The brand spec names exact grounds per file, so the rule reads it literally:
 *
 * 1. Over a photograph, the file the spec names for photographs (the white mono).
 * 2. When every possible ground is one the spec names for a file, that file — full colour first.
 * 3. Otherwise a one-colour file, whichever of white and black has the better worst-case
 *    contrast against those grounds. The spec does not name a tinted panel, and a one-colour
 *    logo is the conservative reading of that silence; recolouring the full-colour file to fit
 *    would break its first rule.
 *
 * `exempt` is true for rule 2 only. An approved file on its approved ground is the brand's own
 * decision (WCAG 1.4.3 exempts logotypes for the same reason), so the contrast gates measure the
 * one-colour fallbacks and leave the approved pairing alone.
 */
export declare function chooseLogotypeVariant(logotype: KitLogotype, grounds: readonly string[], onPhoto: boolean): {
    variant: LogotypeVariant;
    exempt: boolean;
} | null;
//# sourceMappingURL=brand-kit.d.ts.map