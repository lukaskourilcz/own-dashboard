import { type CarouselTemplate } from "./schema.js";
/** How much smaller the Ukrainian line sets. */
export declare const UA_SCALE = 0.85;
/** How much smaller it sets on the cover, where the Czech hook is doing more work. */
export declare const UA_COVER_SCALE = 0.8;
export type TehdejsiSlideKind = "cover" | "body" | "photo" | "outro";
/** The Czech slot for slide N, one-based and zero-padded so slots sort the way slides read. */
export declare function tehdejsiCsSlot(index: number): string;
/** The Ukrainian slot beside it. Always derived, never typed by a caller. */
export declare function tehdejsiUaSlot(index: number): string;
export declare const TEHDEJSI_EYEBROW_SLOT = "eyebrow";
export declare const TEHDEJSI_CHIP_SLOT = "year-place";
export declare const TEHDEJSI_ATTRIBUTION_SLOT = "attribution";
export declare const TEHDEJSI_PHOTO_SLOT = "image";
export declare function tehdejsiTemplateId(slideCount: number): string;
/**
 * The deck, sized to the feature.
 *
 * Slide two is the photo slide whenever the deck is long enough to have one, which is where a
 * licensed photograph goes and therefore the one slide whose attribution is not optional. The
 * attribution slot is required on *every* slide rather than only that one: a footer that appears
 * and disappears is a layout that jumps, and a slide with no photograph puts the source of its
 * fact there instead.
 */
export declare function tehdejsiDeckTemplate(slideCount: number): CarouselTemplate;
export declare const TEHDEJSI_MIN_SLIDES = 3;
export declare const TEHDEJSI_MAX_SLIDES = 8;
export declare function tehdejsiDeckTemplates(): readonly CarouselTemplate[];
export interface TehdejsiPhotoIssue {
    rule: string;
    detail: string;
}
/**
 * A photograph renders with its attribution or it does not render.
 *
 * The contract already refuses a media record whose licence needs an attribution string and does
 * not carry one. This is the other half of the same rule, at the boundary where it can actually
 * be broken: a record can be perfect and the payload can still reach the renderer with the
 * attribution slot empty, and what ships then is a licensed photograph credited to nobody.
 *
 * The check is deliberately two-sided. An attribution with no photograph is also refused — not
 * because it is unsafe, but because it means a slide is claiming a source for a picture it does
 * not have, and a credit under an empty frame is its own kind of false statement.
 */
export declare function tehdejsiPhotoIssues(input: {
    /** The payload's strings, as they will reach the renderer. */
    strings: Readonly<Record<string, string>>;
    /** True when a photograph is bound to the image slot. */
    hasPhoto: boolean;
    /** The licence the photograph ships under, or null for the venture's own render. */
    licence?: string | null;
}): TehdejsiPhotoIssue[];
/** Whether a payload may be rendered as a photo slide. */
export declare function tehdejsiPhotoAllowed(issues: readonly TehdejsiPhotoIssue[]): boolean;
//# sourceMappingURL=families-tehdejsi.d.ts.map