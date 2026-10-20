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
    /** The single type slide's blue rule above its kicker. */
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
 * The band every flowed slide is composed in: under the logotype row, above the credit line.
 * A slide whose words and pictures are shorter than it gives the rest back as described above.
 */
export declare const DNESKAI_AREA: {
    readonly top: 166;
    readonly bottom: 1196;
};
/**
 * The share of the leftover height set above a centred group. Under a half, so the group's centre
 * sits a little above the slide's middle, where a centred block reads as centred rather than low.
 */
export declare const DNESKAI_OPTICAL_SHARE = 0.42;
/** One text slot as the fitter set it: how many lines, at what size. No lines means empty. */
export interface DneskaiMeasuredText {
    lines: number;
    fontSize: number;
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