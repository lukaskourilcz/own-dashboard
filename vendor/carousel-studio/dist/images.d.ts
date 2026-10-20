import type { ImageCrop } from "./schema.js";
import type { CarouselRenderInput } from "./renderer.js";
/**
 * How a photograph is cut to its frame: which region of the source, and the size it is drawn at.
 *
 * Done in sharp before the bytes reach the SVG rather than with `preserveAspectRatio`, which can
 * only ever centre. The region has the frame's own shape for a `cover` fit, so the SVG's `slice`
 * has nothing left to cut, and the source's shape for `contain`, so nothing is cut at all. Zoom
 * shrinks the region around the focal point; the region is then slid back inside the picture, so
 * a focal point near an edge keeps the edge rather than drawing past it.
 *
 * Pure arithmetic on integers, so the same picture, crop and frame cut the same pixels everywhere.
 */
export interface CropRegion {
    left: number;
    top: number;
    width: number;
    height: number;
    /** The pixel size the region is resampled to: the frame's, or the contained picture's. */
    outWidth: number;
    outHeight: number;
}
export declare function cropRegion(source: {
    width: number;
    height: number;
}, crop: Pick<ImageCrop, "focal" | "zoom">, frame: {
    width: number;
    height: number;
}, fit: "cover" | "contain"): CropRegion;
/** Cut and resample one photograph for its frame, as PNG. */
export declare function cropImage(bytes: Buffer, crop: Pick<ImageCrop, "focal" | "zoom">, frame: {
    width: number;
    height: number;
}, fit: "cover" | "contain"): Promise<Buffer>;
/**
 * The photograph, as the template asked for it.
 *
 * Done with sharp before the bytes reach the SVG, never as an SVG filter: librsvg's filter
 * support is the same quiet-failure surface as its WebP handling, and a treatment that silently
 * does nothing is worse than one that is not offered. `duotone` multiplies the greyscale by the
 * slide's accent, which is what makes it read as the venture's own colour rather than as a filter.
 *
 * Returns the input untouched when nothing asks for a treatment, so a v1 template's bytes — and
 * therefore its hashes — are exactly what they were.
 */
export declare function treatImage(bytes: Buffer, treatment: "none" | "mono" | "duotone", accentHex: string): Promise<Buffer>;
export declare function isPrepared(bytes: Buffer): boolean;
/** Whether `bytes` are the cut this render's crop of `slot` asks for, made by this module. */
export declare function isCutFor(input: Pick<CarouselRenderInput, "template" | "format">, slot: string, crop: ImageCrop, bytes: Buffer): boolean;
/**
 * The photographs as the template and payload ask for them: cropped, then treated.
 *
 * Returns the caller's own record untouched when nothing is cropped or treated, so a v1 template's
 * bytes — and therefore its hashes — are exactly what they were. Idempotent: bytes it has already
 * produced pass through a second time unchanged.
 */
export declare function prepareCarouselImages(input: CarouselRenderInput): Promise<CarouselRenderInput["images"]>;
//# sourceMappingURL=images.d.ts.map