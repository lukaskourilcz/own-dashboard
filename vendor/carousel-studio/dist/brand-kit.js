import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
export const BRAND_KITS_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "brand-kits");
const HexSchema = z.string().regex(/^#[0-9a-f]{6}$/, "lowercase #rrggbb");
const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const VentureIdSchema = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const FileNameSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*\.(svg|png)$/, "a flat .svg or .png file name");
const NoteSchema = z.string().trim().min(3).max(400);
/**
 * What kind of drawing an asset is. `logotype` and `lockup` are the name (a lockup adds a symbol),
 * `mark` is a symbol alone, `icon` a favicon or app tile, `share-card` a ready Open Graph image.
 */
export const BrandKitAssetKindSchema = z.enum(["logotype", "lockup", "mark", "icon", "share-card"]);
const ViewBoxSchema = z.tuple([z.number().finite(), z.number().finite(), z.number().positive(), z.number().positive()]);
const BrandKitAssetSchema = z.strictObject({
    /** Unique within the kit, e.g. `logo-on-light` or `fin-clean-white`. */
    role: z.string().regex(/^[a-z][a-z0-9-]*$/).max(60),
    kind: BrandKitAssetKindSchema,
    label: z.string().trim().min(2).max(60),
    file: FileNameSchema,
    mediaType: z.enum(["image/svg+xml", "image/png"]),
    sha256: Sha256Schema,
    bytes: z.number().int().positive().max(2_000_000),
    /** Where the file came from: a path in the source repository, or in the handoff. */
    sourcePath: z.string().trim().min(3).max(200),
    /** What the brand spec says this file is for, in its own words. */
    use: NoteSchema,
    /** The exact ground colours the spec names for this file. Empty means none is named. */
    grounds: z.array(HexSchema).max(6).default([]),
    /** Whether the spec names a photograph or a solid brand colour as this file's ground. */
    onPhoto: z.boolean().default(false),
    /** Every colour the file draws, lowercase. What a contrast check has to measure. */
    inks: z.array(HexSchema).min(1).max(8),
    /** An SVG's own viewBox: min-x, min-y, width, height. */
    viewBox: ViewBoxSchema.optional(),
    /** The spec's smallest size for this file, as the spec states it. */
    minimumSize: z.string().trim().min(2).max(60).optional(),
    /** Pixel size, for raster files. */
    pixels: z.strictObject({ width: z.number().int().positive(), height: z.number().int().positive() }).optional(),
    /**
     * Whether the studio may draw this file in a template's logo slot. Only outlined SVGs qualify,
     * and the order of these files in `assets` is the order the renderer prefers them in.
     */
    logoSlot: z.boolean().default(false)
});
const PaletteSchema = z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    label: z.string().trim().min(2).max(80),
    /** The grounds this palette is drawn on. */
    grounds: z.array(HexSchema).max(6),
    colors: z.array(z.strictObject({ role: z.string().trim().min(1).max(60), value: HexSchema })).min(1).max(12)
});
/** One carousel token and where its value comes from in the venture's own design system. */
const CarouselTokenSchema = z.strictObject({ value: HexSchema, source: NoteSchema });
/** The studio's seven carousel tokens, each with the design-system value it came from. */
const CarouselPaletteSchema = z.strictObject({
    background: CarouselTokenSchema,
    surface: CarouselTokenSchema,
    "surface-strong": CarouselTokenSchema,
    foreground: CarouselTokenSchema,
    muted: CarouselTokenSchema,
    accent: CarouselTokenSchema,
    secondary: CarouselTokenSchema
});
/** One of the studio's three type slots: a committed family (`studio/src/fonts.ts`) and why. */
const CarouselFontSchema = z.strictObject({ family: z.string().trim().min(2).max(100), source: NoteSchema });
/** The studio's three type slots, as `carouselFonts` spells them. Named so a look reuses it. */
const CarouselFontsSchema = z.strictObject({ headline: CarouselFontSchema, body: CarouselFontSchema, mono: CarouselFontSchema });
const LookIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/).max(40);
const GroundIdSchema = z.string().regex(/^[a-z][a-z0-9-]*$/).max(40);
/**
 * How the studio dresses a kitted brand beyond its tokens: what the spec forbids, where the logo may
 * appear, which ground each slide of a deck stands on and which mark sits in its corner.
 */
const CarouselStyleSchema = z.strictObject({
    /** The spec forbids gradients, blur, glow and shadows: mesh backdrops go, glow goes, seams stay hard. */
    flat: z.boolean(),
    /** The spec asks for zero radii on panels. */
    squareCorners: z.boolean().default(false),
    /** Where the logotype may appear: on every slide, or only on a deck's last slide. */
    logo: z.enum(["every-slide", "last-slide"]).default("every-slide"),
    /** Named grounds, each a full set of the seven tokens a slide on that ground uses. */
    grounds: z.array(z.strictObject({ id: GroundIdSchema, label: z.string().trim().min(2).max(80), palette: CarouselPaletteSchema })).max(6).default([]),
    /**
     * The ground of each slide, first to last. A deck of another length keeps the first and the last
     * and walks the ones between in order.
     */
    groundSequence: z.array(GroundIdSchema).max(8).default([]),
    /** A mark drawn in the top-right corner of every slide, in the file the slide's ground calls for. */
    cornerMark: z.strictObject({
        /** Asset roles of `mark` SVGs, in preference order; the ground picks one as it picks a logotype. */
        roles: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).min(1).max(4),
        /** Width on the 1080 px canvas; other canvases scale it with their width. */
        widthPx: z.number().positive().max(200),
        marginPx: z.number().min(0).max(200),
        /** The top edge on a story, below the platform's own chrome. */
        storyTopPx: z.number().min(0).max(600)
    }).optional(),
    /** Colours a slide may draw that are neither a token nor a file's ink. */
    neutrals: z.array(HexSchema).max(4).default([])
});
const DocumentsSchema = z.array(z.string().trim().min(3).max(200)).min(1).max(8);
/**
 * Where the files came from. A repository source pins an exact commit. A handoff is files the
 * owner sent before they reached a repository; it names where they will be pinned, and the kit is
 * re-pinned to a repository source once they land there.
 */
const BrandKitSourceSchema = z.discriminatedUnion("kind", [
    z.strictObject({
        kind: z.literal("repository"),
        repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
        ref: z.string().trim().min(1).max(120),
        commit: z.string().regex(/^[0-9a-f]{40}$/),
        /** The documents the rules below were taken from, as paths in that repository. */
        documents: DocumentsSchema
    }),
    z.strictObject({
        kind: z.literal("handoff"),
        receivedOn: z.iso.date(),
        from: z.string().trim().min(2).max(80),
        description: NoteSchema,
        /** Where the files will live once merged, so the kit can be re-pinned to that commit. */
        pinTo: NoteSchema,
        documents: DocumentsSchema
    })
]);
export const BrandKitManifestSchema = z.strictObject({
    schemaVersion: z.literal("brand-kit/1"),
    /** The venture id in `config/ventures.json`; the kit's directory has the same name. */
    venture: VentureIdSchema,
    /** The studio brand this kit dresses (`CAROUSEL_BRANDS` key). A venture may market another name. */
    studioBrand: VentureIdSchema,
    displayName: z.string().trim().min(2).max(60),
    status: z.literal("approved"),
    approvedOn: z.iso.date(),
    source: BrandKitSourceSchema,
    logotype: z.strictObject({
        /** The primary logo file's viewBox: min-x, min-y, width, height. */
        viewBox: ViewBoxSchema,
        /** Width over height, rounded to two places. */
        aspectRatio: z.number().positive(),
        /** Always true: the name is drawn as paths, never set in a font. */
        outlined: z.literal(true),
        clearSpace: z.strictObject({
            /** Clear space on every side as a fraction of the logo's height, when the spec gives one. */
            ratioOfHeight: z.number().min(0).max(1).optional(),
            basis: NoteSchema
        }),
        /** The smallest height the logotype may be drawn at, when the spec gives one in pixels. */
        minimumHeightPx: z.number().positive().optional(),
        sizes: z.array(z.strictObject({ place: z.string().trim().min(2).max(80), size: z.string().trim().min(1).max(60) })).max(12)
    }),
    palettes: z.array(PaletteSchema).min(1).max(8),
    /**
     * The studio's seven carousel tokens, when this kit sets them. `library.ts` must carry exactly
     * these values for `studioBrand`; a test holds the two together.
     */
    carouselPalette: CarouselPaletteSchema.optional(),
    /** The studio's three type slots, when this kit sets them. `library.ts` carries the same families. */
    carouselFonts: CarouselFontsSchema.optional(),
    carouselStyle: CarouselStyleSchema.optional(),
    /**
     * Named looks, one file each in `looks/<id>.json`. `default` is the look a render uses when none
     * is asked for; its palette and fonts must equal `carouselPalette` and `carouselFonts` entry for
     * entry, which is what keeps every render made before looks existed byte-identical.
     */
    carouselLooks: z.strictObject({ default: LookIdSchema, ids: z.array(LookIdSchema).min(1).max(12) }).optional(),
    rules: z.array(NoteSchema).min(1).max(20),
    doNots: z.array(NoteSchema).min(1).max(20),
    /** How the brand's social posts are built, when the spec says. */
    socialRules: z.array(NoteSchema).max(12).default([]),
    typography: z.array(NoteSchema).max(10),
    assets: z.array(BrandKitAssetSchema).min(1).max(40)
}).superRefine((kit, context) => {
    const files = new Set();
    const roles = new Set();
    kit.assets.forEach((asset, index) => {
        if (files.has(asset.file))
            context.addIssue({ code: "custom", message: `Duplicate file ${asset.file}`, path: ["assets", index, "file"] });
        if (roles.has(asset.role))
            context.addIssue({ code: "custom", message: `Duplicate role ${asset.role}`, path: ["assets", index, "role"] });
        files.add(asset.file);
        roles.add(asset.role);
        const svg = asset.file.endsWith(".svg");
        if (svg !== (asset.mediaType === "image/svg+xml")) {
            context.addIssue({ code: "custom", message: "mediaType does not match the file extension", path: ["assets", index, "mediaType"] });
        }
        if (svg && !asset.viewBox)
            context.addIssue({ code: "custom", message: "An SVG asset records its viewBox", path: ["assets", index, "viewBox"] });
        if (!svg && !asset.pixels)
            context.addIssue({ code: "custom", message: "A PNG asset records its pixel size", path: ["assets", index, "pixels"] });
        if (asset.logoSlot && (!svg || (asset.kind !== "logotype" && asset.kind !== "lockup"))) {
            context.addIssue({ code: "custom", message: "Only an outlined SVG logotype or lockup may fill the logo slot", path: ["assets", index, "logoSlot"] });
        }
    });
    if (!kit.assets.some((asset) => asset.kind === "logotype" || asset.kind === "lockup")) {
        context.addIssue({ code: "custom", message: "A kit carries at least one logotype or lockup file", path: ["assets"] });
    }
    if (kit.assets.some((asset) => asset.logoSlot)) {
        if (kit.logotype.clearSpace.ratioOfHeight === undefined) {
            context.addIssue({ code: "custom", message: "A kit the renderer draws states its clear space as a ratio", path: ["logotype", "clearSpace", "ratioOfHeight"] });
        }
        if (kit.logotype.minimumHeightPx === undefined) {
            context.addIssue({ code: "custom", message: "A kit the renderer draws states a minimum height in pixels", path: ["logotype", "minimumHeightPx"] });
        }
    }
    if (kit.carouselStyle) {
        const style = kit.carouselStyle;
        if (!kit.carouselPalette)
            context.addIssue({ code: "custom", message: "A carousel style needs the carousel palette it dresses", path: ["carouselStyle"] });
        const grounds = new Set(style.grounds.map((ground) => ground.id));
        if (grounds.size !== style.grounds.length)
            context.addIssue({ code: "custom", message: "Ground ids repeat", path: ["carouselStyle", "grounds"] });
        style.groundSequence.forEach((id, index) => {
            if (!grounds.has(id))
                context.addIssue({ code: "custom", message: `Ground ${id} is not declared`, path: ["carouselStyle", "groundSequence", index] });
        });
        if (style.groundSequence.length === 1)
            context.addIssue({ code: "custom", message: "A ground sequence names at least a first and a last ground", path: ["carouselStyle", "groundSequence"] });
        style.cornerMark?.roles.forEach((role, index) => {
            const asset = kit.assets.find((candidate) => candidate.role === role);
            if (!asset || asset.kind !== "mark" || asset.mediaType !== "image/svg+xml") {
                context.addIssue({ code: "custom", message: `Corner mark ${role} is not an SVG mark in this kit`, path: ["carouselStyle", "cornerMark", "roles", index] });
            }
        });
    }
    if (kit.carouselLooks) {
        const looks = kit.carouselLooks;
        if (new Set(looks.ids).size !== looks.ids.length)
            context.addIssue({ code: "custom", message: "Look ids repeat", path: ["carouselLooks", "ids"] });
        if (!looks.ids.includes(looks.default))
            context.addIssue({ code: "custom", message: `The default look ${looks.default} is not listed`, path: ["carouselLooks", "default"] });
        if (!kit.carouselPalette || !kit.carouselFonts) {
            context.addIssue({ code: "custom", message: "Carousel looks need the carousel palette and fonts the default look equals", path: ["carouselLooks"] });
        }
    }
    const [, , width, height] = kit.logotype.viewBox;
    if (Math.abs(width / height - kit.logotype.aspectRatio) > 0.01) {
        context.addIssue({ code: "custom", message: `aspectRatio ${kit.logotype.aspectRatio} disagrees with the viewBox (${(width / height).toFixed(3)})`, path: ["logotype", "aspectRatio"] });
    }
});
/**
 * One named look of a kit (`looks/<id>.json`): a full carousel palette, the three type slots and
 * the style flags the look sets. A studio file format, not a published contract.
 */
export const CarouselLookSchema = z.strictObject({
    schemaVersion: z.literal("brand-kit-look/1"),
    id: LookIdSchema,
    label: z.string().trim().min(2).max(80),
    /** What the look is for, for the Design Lab and the kit author. */
    purpose: NoteSchema,
    /** The seven carousel tokens, each with its value and where it came from. */
    palette: CarouselPaletteSchema,
    /** The three type slots. Families are checked against `FONT_FAMILIES` in `kit-style.ts`. */
    fonts: CarouselFontsSchema,
    /**
     * Flags the look sets over the kit's `carouselStyle`. A look may set `flat` or `squareCorners`
     * where the kit leaves them unset and may not clear one the kit sets: those are the spec's
     * do-nots and a look is not a spec change. `logo` is the look's own.
     */
    style: z.strictObject({
        flat: z.boolean().optional(),
        squareCorners: z.boolean().optional(),
        logo: z.enum(["every-slide", "last-slide"]).optional()
    }).default({})
});
/** The directory inside a kit that holds its look files. */
export const BRAND_KIT_LOOKS_DIRECTORY = "looks";
/** Every problem the kit's look files have, and the looks when there is none. */
function readLooks(directory, manifest) {
    const problems = [];
    const looks = [];
    const declared = manifest.carouselLooks?.ids ?? [];
    const folder = path.join(directory, BRAND_KIT_LOOKS_DIRECTORY);
    if (existsSync(folder)) {
        for (const file of readdirSync(folder).sort()) {
            if (!declared.some((id) => `${id}.json` === file))
                problems.push(`${BRAND_KIT_LOOKS_DIRECTORY}/ holds ${file} the manifest does not list`);
        }
    }
    for (const id of declared) {
        const name = `${BRAND_KIT_LOOKS_DIRECTORY}/${id}.json`;
        const file = path.join(folder, `${id}.json`);
        if (!existsSync(file)) {
            problems.push(`${name} is missing`);
            continue;
        }
        let raw;
        try {
            raw = JSON.parse(readFileSync(file, "utf8"));
        }
        catch (error) {
            problems.push(`${name} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
            continue;
        }
        const parsed = CarouselLookSchema.safeParse(raw);
        if (!parsed.success) {
            problems.push(...parsed.error.issues.map((issue) => `${name}: ${issue.path.join(".") || "look"}: ${issue.message}`));
            continue;
        }
        const look = parsed.data;
        if (look.id !== id)
            problems.push(`${name} names look ${look.id}, file is ${id}`);
        for (const flag of ["flat", "squareCorners"]) {
            if (manifest.carouselStyle?.[flag] === true && look.style[flag] === false)
                problems.push(`look ${id} clears ${flag}, which the kit sets`);
        }
        if (id === manifest.carouselLooks?.default) {
            for (const [token, entry] of Object.entries(manifest.carouselPalette ?? {})) {
                const mine = look.palette[token];
                if (mine.value !== entry.value || mine.source !== entry.source)
                    problems.push(`the default look ${id} differs from carouselPalette at ${token}`);
            }
            for (const [slot, entry] of Object.entries(manifest.carouselFonts ?? {})) {
                const mine = look.fonts[slot];
                if (mine.family !== entry.family || mine.source !== entry.source)
                    problems.push(`the default look ${id} differs from carouselFonts at ${slot}`);
            }
        }
        looks.push(look);
    }
    return { looks: problems.length ? [] : looks, problems };
}
function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
/**
 * Read and verify one kit: the manifest parses, its venture matches its directory, and every
 * file it names exists with the recorded size and hash.
 *
 * Never throws. A missing or damaged kit is reported, because the admin shows it as unavailable
 * and the renderer refuses to draw from it, and those are two different reactions to one fact.
 */
export function readBrandKit(venture, root = BRAND_KITS_DIRECTORY) {
    const directory = path.join(root, venture);
    const manifestPath = path.join(directory, "manifest.json");
    if (!existsSync(manifestPath))
        return { directory, manifest: null, looks: [], problems: ["manifest.json is missing"] };
    let raw;
    try {
        raw = JSON.parse(readFileSync(manifestPath, "utf8"));
    }
    catch (error) {
        return { directory, manifest: null, looks: [], problems: [`manifest.json is not JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const parsed = BrandKitManifestSchema.safeParse(raw);
    if (!parsed.success) {
        return { directory, manifest: null, looks: [], problems: parsed.error.issues.map((issue) => `${issue.path.join(".") || "manifest"}: ${issue.message}`) };
    }
    const manifest = parsed.data;
    const problems = [];
    if (manifest.venture !== venture)
        problems.push(`manifest names venture ${manifest.venture}, directory is ${venture}`);
    for (const asset of manifest.assets) {
        const file = path.join(directory, asset.file);
        if (!existsSync(file)) {
            problems.push(`${asset.file} is missing`);
            continue;
        }
        const bytes = readFileSync(file);
        if (bytes.length !== asset.bytes)
            problems.push(`${asset.file} is ${bytes.length} bytes, manifest says ${asset.bytes}`);
        if (sha256(bytes) !== asset.sha256)
            problems.push(`${asset.file} does not match its recorded sha256`);
    }
    const looks = readLooks(directory, manifest);
    problems.push(...looks.problems);
    return { directory, manifest, looks: looks.looks, problems };
}
/** Every kit directory, in name order. A directory without a manifest is still listed. */
export function brandKitVentures(root = BRAND_KITS_DIRECTORY) {
    if (!existsSync(root))
        return [];
    return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && VentureIdSchema.safeParse(entry.name).success)
        .map((entry) => entry.name)
        .sort();
}
export function readBrandKits(root = BRAND_KITS_DIRECTORY) {
    return brandKitVentures(root).map((venture) => readBrandKit(venture, root));
}
/** A placeholder every id and `url(#…)` in logo markup carries, replaced with a per-layer id. */
export const LOGO_ID = "__logo__";
/**
 * The drawable part of an SVG file.
 *
 * Only what a nested `<svg>` needs: the root element, `<title>` and `<metadata>` (the provenance
 * manifest the design tool embedded) are dropped, and ids are namespaced so two logos on one
 * slide, or a logo and a gradient, cannot share one. Anything scripted or external is refused
 * rather than stripped, because a kit that needs stripping is not the approved file.
 */
export function logotypeMarkup(svg) {
    if (/<script|<foreignObject|\son[a-z]+=|href="(?!#)/i.test(svg))
        throw new Error("Logotype SVG carries script, foreign content or an external reference");
    const match = /^<svg\b([^>]*)>([\s\S]*)<\/svg>$/.exec(svg.trim());
    if (!match)
        throw new Error("Logotype file is not a single SVG element");
    // Colour set on the root (`fill`, or `color` for `currentColor` strokes) belongs to the drawing,
    // so it moves to a group rather than being lost with the root element.
    const inherited = [...match[1].matchAll(/\s(fill|color)="(#[0-9a-fA-F]{6})"/g)].map(([, name, value]) => ` ${name}="${value}"`).join("");
    const inner = match[2]
        .replace(/<metadata>[\s\S]*?<\/metadata>/g, "")
        .replace(/<title>[\s\S]*?<\/title>/g, "")
        .replace(/\sid="([^"]+)"/g, ` id="${LOGO_ID}$1"`)
        .replace(/url\(#([^)]+)\)/g, `url(#${LOGO_ID}$1)`);
    return inherited ? `<g${inherited}>${inner}</g>` : inner;
}
/**
 * The logotype a kit hands the renderer: null when the kit lets nothing fill the logo slot, and an
 * error naming why when the kit cannot be used.
 */
export function kitLogotype(reading) {
    const { manifest, problems, directory } = reading;
    if (!manifest || problems.length)
        throw new Error(`Brand kit ${path.basename(directory)} is unusable: ${problems.join("; ")}`);
    const variants = manifest.assets.filter((asset) => asset.logoSlot).map((asset) => ({
        role: asset.role,
        viewBox: asset.viewBox,
        grounds: asset.grounds,
        onPhoto: asset.onPhoto,
        inks: asset.inks,
        markup: logotypeMarkup(readFileSync(path.join(directory, asset.file), "utf8"))
    }));
    if (variants.length === 0)
        return null;
    return {
        venture: manifest.venture,
        displayName: manifest.displayName,
        clearSpace: manifest.logotype.clearSpace.ratioOfHeight,
        minimumHeightPx: manifest.logotype.minimumHeightPx,
        variants
    };
}
const logotypeCache = new Map();
/**
 * The logotype for a studio brand, or null when no kit dresses that brand.
 *
 * Read once per process. A kit that exists but fails verification throws: drawing the old
 * wordmark instead would ship a card in an identity the venture has replaced, and nothing would
 * say so.
 */
export function logotypeForBrand(studioBrand) {
    if (logotypeCache.has(studioBrand))
        return logotypeCache.get(studioBrand);
    let found = null;
    for (const reading of readBrandKits()) {
        if (!reading.manifest) {
            // A damaged kit that claims this brand, or sits in its directory, refuses the render. One
            // that belongs to another brand is that brand's problem, and the kit test fails on it.
            if (claimedStudioBrand(reading.directory) === studioBrand) {
                throw new Error(`Brand kit ${path.basename(reading.directory)} is unusable: ${reading.problems.join("; ")}`);
            }
            continue;
        }
        if (reading.manifest.studioBrand !== studioBrand)
            continue;
        // A kit that lets nothing fill the logo slot dresses the admin only; the brand keeps its
        // wordmark until the kit says otherwise.
        found = kitLogotype(reading);
        break;
    }
    logotypeCache.set(studioBrand, found);
    return found;
}
/** The studio brand a manifest names, read without the schema; the directory name when unreadable. */
function claimedStudioBrand(directory) {
    try {
        const raw = JSON.parse(readFileSync(path.join(directory, "manifest.json"), "utf8"));
        if (typeof raw.studioBrand === "string")
            return raw.studioBrand;
    }
    catch {
        // Missing or not JSON: fall through to the directory name.
    }
    return path.basename(directory);
}
function relativeLuminance(hex) {
    const channel = (offset) => {
        const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
        return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
function wcagRatio(left, right) {
    const [light, dark] = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}
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
export function chooseLogotypeVariant(logotype, grounds, onPhoto) {
    const normalised = grounds.map((ground) => ground.toLowerCase());
    if (onPhoto) {
        const photo = logotype.variants.find((variant) => variant.onPhoto);
        if (photo)
            return { variant: photo, exempt: false };
    }
    const approved = logotype.variants.find((variant) => variant.grounds.length > 0 && normalised.length > 0 && normalised.every((ground) => variant.grounds.includes(ground)));
    if (approved)
        return { variant: approved, exempt: true };
    const mono = logotype.variants.filter((variant) => variant.inks.length === 1);
    let best = null;
    for (const variant of mono) {
        const worst = Math.min(...normalised.map((ground) => wcagRatio(variant.inks[0], ground)));
        if (!best || worst > best.worst)
            best = { variant, worst };
    }
    return best ? { variant: best.variant, exempt: false } : null;
}
//# sourceMappingURL=brand-kit.js.map