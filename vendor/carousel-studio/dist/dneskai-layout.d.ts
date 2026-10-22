import { type CarouselTemplate, type ImageCrop } from "./schema.js";
/** The kit's spacing unit in master pixels. Every gap the layout keeps is a whole number of them. */
export declare const DNESKAI_SPACE_UNIT = 8;
/**
 * The gaps between elements, in units, measured from ink to ink: a line of type is measured from
 * its cap line and its last baseline, not from the empty top and bottom of its line box. They are
 * minimums; height left over is added around them, never taken from them.
 */
export declare const DNESKAI_GAPS: {
    /** A kicker or the sources slide's image label above what it labels. */
    readonly labelToText: 4;
    /** A headline above its picture. */
    readonly headlineToPicture: 5;
    /** A picture above the words that explain it. */
    readonly pictureToText: 4;
    /** A split slide's row of words and picture above the explanation under both. */
    readonly rowToBody: 6;
    /** A headline above its explanation in the same column. */
    readonly headlineToBody: 5;
    /** A statement, or a type-only announcement's display headline, above its quieter note. */
    readonly headlineToNote: 8;
    /** Two stacked pictures, and the rows and columns of the sources slide's thumbnails. */
    readonly pictureToPicture: 3;
    /** A rule above a label line. Unused since single type lost its kicker; kept so every metrics table names thirteen gaps. */
    readonly ruleToLabel: 3;
    /** The sources slide's title above its first source. */
    readonly titleToSources: 5;
    /** One source above the next: wider than a line of the same source, so each reads as one. */
    readonly sourceToSource: 3;
    /** The last source above the image label, or above the disclosure when there are no images. */
    readonly sourcesToColophon: 6;
    /** The image label above the thumbnails. */
    readonly labelToPictures: 2;
    /** The thumbnails above the disclosure. */
    readonly picturesToDisclosure: 4;
};
/**
 * The sources slide's thumbnails: three to a row across the 936 px measure, 3:2, with the kit's
 * picture gap between them. The layout shrinks them evenly only when four long sources leave the
 * grid less height than two full rows need.
 */
export declare const DNESKAI_THUMBNAIL_GRID: {
    readonly columns: 3;
    readonly width: 296;
    readonly height: 198;
    readonly gap: 24;
};
/**
 * The band every flowed slide is composed in: under the logotype row, down to 86 px above the
 * foot. It ended at 1196 above a credit line until the owner's decision of 22 October 2026 took
 * credits off the slides; the band now takes that height. A slide whose words and pictures are
 * shorter than it gives the rest back as described above.
 */
export declare const DNESKAI_AREA: {
    readonly top: 166;
    readonly bottom: 1264;
};
/**
 * The share of the leftover height set above a centred group. Under a half, so the group's centre
 * sits a little above the slide's middle, where a centred block reads as centred rather than low.
 */
export declare const DNESKAI_OPTICAL_SHARE = 0.42;
/**
 * Where the cap line sits under the top of a line box, in em, for the kit's three faces: Space
 * Grotesk and IBM Plex Mono have caps 0.70 em tall and Source Serif 4 0.67, under a baseline the
 * renderer sets one em below the frame's top.
 */
export declare const DNESKAI_CAP_OFFSET = 0.3;
/** The single photo's headline panel, as `dneskai-photo.ts` draws it at the foot. */
export declare const DNESKAI_PANEL: {
    /** The panel's top when the band stands at the top of the slide, under the logotype row. */
    readonly top: 152;
    /** The panel's padding on each side of the hugged lines (the template's `padding`). */
    readonly padding: 24;
    /** How far below the panel's top the headline frame starts: the cap line then sits about 40 px in. */
    readonly inset: 17;
    /** Panel floor to the line under it, and that line's floor to the kicker row, as at the foot. */
    readonly toBody: 22;
    readonly toKicker: 28;
    /** Clearance the focal point keeps from the band before the band moves out of its way. */
    readonly clearance: 48;
};
export type DneskaiGapName = keyof typeof DNESKAI_GAPS;
export interface DneskaiStackItem {
    /** A text slot, an image slot, `rule` (the slide's first rule layer) or `thumbnails` (sources only). */
    key: string;
    /** Visual space above the item, ink to ink: a named gap reads the kit's table, a number is units. Ignored on the first item. */
    gap: DneskaiGapName | number;
    /**
     * Pixels the item moves up after its gap: for the item under a glyph whose ink stops well above
     * its baseline, such as a quotation mark, which the line-box arithmetic cannot see. Absent: 0.
     */
    pull?: number;
}
export type DneskaiFlow = {
    kind: "cover-static";
}
/**
 * `plate`: the shape layer drawn directly before the picture is its plate, moved with it and
 * standing `plate` px clear of it above and below; the gaps are measured to the plate. `top`: where
 * the headline starts, when a slide sets a label line above it under the header. Both absent:
 * the editorial figure.
 */
 | {
    kind: "figure";
    plate?: number;
    top?: number;
}
/** `align: "top"` stands the words and the pictures on one top line instead of centring the shorter column. */
 | {
    kind: "split";
    align?: "top";
} | {
    kind: "split-pair";
    align?: "top";
} | {
    kind: "statement";
} | {
    kind: "sources";
} | {
    kind: "single-type";
} | {
    kind: "single-photo";
}
/**
 * `floor` stands the group's last line on the area's floor, whatever the kit's optical share.
 * `follow`: the stops of every image shade, by index from `from` up to but not including `to`,
 * that move with the group. They are declared for the group at its declared frames; when the
 * group lands lower they move down by as much, each held between the stop before it and the
 * first fixed stop after it, so the shade deepens where the words actually start and the
 * picture stays clear above them. The stop at `under`, the one the words were checked on, never
 * passes the top of any text frame over the picture, an empty one included. Absent: shades stay
 * as declared.
 */
 | {
    kind: "stack";
    anchor: "centre" | "top" | "floor";
    items: readonly DneskaiStackItem[];
    follow?: {
        from: number;
        to: number;
        under: number;
    };
};
export interface DneskaiLayoutMetrics {
    readonly unit: number;
    /** All thirteen gaps; a kit copies the editorial table and changes what it wants. */
    readonly gaps: Readonly<Record<DneskaiGapName, number>>;
    readonly area: {
        readonly top: number;
        readonly bottom: number;
    };
    readonly opticalShare: number;
    readonly thumbnails: {
        readonly columns: number;
        readonly width: number;
        readonly height: number;
        readonly gap: number;
    };
    readonly panel: {
        readonly top: number;
        readonly padding: number;
        readonly inset: number;
        readonly toBody: number;
        readonly toKicker: number;
        readonly clearance: number;
    };
    /**
     * Where the cap line sits under the top of a line box, in em, for every face. Absent: one minus
     * the face's own cap height from the metrics table. The editorial kit pins 0.3, the constant its
     * recorded hashes were laid out with.
     */
    readonly capOffset?: number;
}
export declare const DNESKAI_EDITORIAL_METRICS: DneskaiLayoutMetrics;
export declare const DNESKAI_STACK_PRESETS: {
    readonly statement: DneskaiFlow;
    readonly singleType: DneskaiFlow;
};
/** One text slot as the fitter set it: how many lines, at what size. No lines means empty. */
export interface DneskaiMeasuredText {
    lines: number;
    fontSize: number;
    /** Cap height in em, used when the kit does not pin an offset. */
    capHeight?: number;
}
/** One decoded photograph: its oriented pixel size and the crop it is drawn with. */
export interface DneskaiLaidPicture {
    width: number;
    height: number;
    crop: ImageCrop;
    /** Whether the caller set the focal point, rather than the centre being assumed. */
    focalGiven: boolean;
}
export interface DneskaiLayoutInput {
    flow: DneskaiFlow;
    metrics: DneskaiLayoutMetrics;
    /** The kit template, with its declared (largest) frames. */
    template: CarouselTemplate;
    /** Every text slot as fitted in the declared frames. */
    text: Readonly<Record<string, DneskaiMeasuredText>>;
    /** The photographs that decoded, by slot. A missing one is laid out as its whole frame. */
    pictures: Readonly<Record<string, DneskaiLaidPicture>>;
}
/**
 * The slide laid out for what it holds. The cover photo is returned as declared, and so is the
 * single photo unless its focal point would sit under the headline band.
 */
export declare function layoutDneskaiSlide(input: DneskaiLayoutInput): CarouselTemplate;
//# sourceMappingURL=dneskai-layout.d.ts.map