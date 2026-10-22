import { type CarouselLayerInput, type CarouselTemplate, type CarouselTemplateInput } from "../schema.js";
/**
 * DNESKAi's photographic slides for Instagram (quorum#603), one single-slide template per type.
 *
 * Single-slide templates for the reason the post decks use them: a carousel here is assembled from
 * whatever the day's story has — one photograph or four, a chart, a quote — so each slide is
 * chosen on its own and the deck is the sequence. No slide prints its place in the deck, and none
 * prints a picture credit: since the owner's decision of 22 October 2026 the credits travel in the
 * Instagram caption, and the first slide of a post carries its headline and nothing else.
 *
 * Composed for the 4:5 master alone. These are photographic compositions: a cover's headline
 * stands on the floor of a full-bleed picture and the figure plates are sized to the 1080 × 1350
 * frame, so none of them is honest at 1:1 or 9:16 and none claims to be.
 *
 * The kit's rules hold here as everywhere: square corners, no glow, no blur, no ornament, no
 * emoji. Photographs are drawn in colour (treatment `none`); a mono or duotone DNESKAi photograph
 * is refused by the tests. The one gradient is the cover's shade, a single ink at varying opacity
 * drawn only over a photograph, which the flat rule keeps (see `ShadeSchema`).
 *
 * Geometry is written in master pixels and converted once, so a reader can check it against the
 * 1080 × 1350 renders without dividing.
 *
 * The frames below are the largest each element may take: the words are fitted in them and the
 * template checks pass on them. Every template but the cover is drawn laid out for its content
 * (`dneskai-layout.ts`): frames shrink to the lines and pictures they hold and stack in reading
 * order with the kit's gaps, and the height left over is set around them on purpose.
 */
export declare const W: 1080, H: 1350;
/** The version of a template the render lays out for its content (`dneskai-layout.ts`). */
export declare const FLOWED = "1.1.0";
/** Margins: 72 px clears the 3:4 profile-grid crop of a 4:5 post (34 px a side) with room left. */
export declare const LEFT = 72;
export declare const MEASURE = 936;
export declare const RIGHT: number;
type Box = {
    x: number;
    y: number;
    width: number;
    height: number;
};
export declare const box: (x: number, y: number, width: number, height: number) => Box;
type TextOptions = Partial<Extract<CarouselLayerInput, {
    type: "text";
}>>;
export declare const text: (slot: string, frame: Box, options: TextOptions) => CarouselLayerInput;
export declare const fill: (frame: Box, fillToken: string) => CarouselLayerInput;
/** The DNESKAi logotype, top left, drawn from the kit's outlines at about 34 px high. */
export declare const logo: CarouselLayerInput;
/** An uppercase, tracked label in the mono face: a kicker, or the sources slide's image label. */
export declare const kicker: (colorToken: string, frame: Box, size?: number, maxChars?: number, slot?: string) => CarouselLayerInput;
export declare const body: (frame: Box, options: TextOptions) => CarouselLayerInput;
/**
 * A photograph or figure with a 2 px hairline around the picture as drawn. A contained chart keeps
 * its own shape and its own margins; a covering photograph fills the frame.
 */
export declare function plated(slot: string, x: number, y: number, width: number, height: number, options: {
    optional: boolean;
    fit: "cover" | "contain";
}): CarouselLayerInput[];
/**
 * The cover's shade: a touch of ink behind the logotype, clear through the picture's middle, then
 * deep enough under the headline that white type clears 4.5:1 over a white photograph.
 */
export declare const COVER_SHADE: {
    colorToken: string;
    stops: {
        at: number;
        opacity: number;
    }[];
};
export declare const bleed: (slot: string) => CarouselLayerInput;
export declare function template(input: {
    id: string;
    name: string;
    description: string;
    backgroundToken: string;
    layers: CarouselLayerInput[];
    variants?: CarouselTemplateInput["slides"][number]["variants"];
    /** 1.0.0 is the first composition; a template the render lays out for its content is 1.1.0. */
    version?: string;
}): CarouselTemplate;
export {};
//# sourceMappingURL=compose.d.ts.map