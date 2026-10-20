import { type CarouselFormat, type CarouselTemplate } from "./schema.js";
import type { TemplateCheck } from "./validation.js";
/**
 * The canvas shapes this studio composes for, each named the way a platform names it.
 *
 * Not a catalogue of everything Instagram accepts — 1.91:1 landscape is accepted and this studio
 * does not compose it, so it is not here. A shape nobody draws does not belong in a check.
 */
export declare const ACCEPTED_RATIOS: ReadonlyArray<{
    readonly name: string;
    readonly ratio: number;
}>;
/** The limits a composition is held to before it may enter the library. */
export declare const PLATFORM_LIMITS: {
    /** What Instagram itself accepts in one post. */
    readonly maxItemsPerPost: 20;
    /** What Instagram itself requires before a post is a carousel rather than a single image. */
    readonly minCarouselItems: 2;
    /** What the guarded Graph connector this repository publishes through will carry. Narrower. */
    readonly maxItemsPerConnectorItem: 10;
    /** Every item of one post is shown at one orientation. */
    readonly oneRatioPerPost: true;
    readonly ratioTolerance: 0.01;
};
/** The shape this canvas is, or null when it is none of the ones the studio composes. */
export declare function ratioName(spec: {
    readonly width: number;
    readonly height: number;
}): string | null;
/**
 * Whether this template could be posted as it stands, at this canvas.
 *
 * Reported as one check with every reason it failed, rather than the first: a composer fixing a
 * layout should see the whole list once instead of discovering it a run at a time.
 */
export declare function platformLimitCheck(template: CarouselTemplate, format: CarouselFormat): TemplateCheck;
//# sourceMappingURL=platform-limits.d.ts.map