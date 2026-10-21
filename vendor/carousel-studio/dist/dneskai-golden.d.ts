import { z } from "zod";
import { type DneskaiSlideInput } from "./dneskai-slide.js";
/**
 * The golden renders of the DNESKAi photo kit: one pinned slide per template, hashed and committed.
 *
 * The same receipt `golden.ts` keeps for the shared families, through the API OwnDashboard calls
 * rather than through the bare renderer, so the slot mapping, the folio, the fixed strings and the
 * crop path are pinned with the composition.
 *
 * The stand-in photographs are drawn from integer arithmetic and are exactly the size of the frame
 * they are laid out in — a contained picture's frame is the rectangle it is drawn at, so a picture
 * that fits its column at 1× keeps its size — and the crop's resample is the identity: the pinned
 * bytes do not lean on a resize kernel. `cover-photo-crop` pins the crop arithmetic the same way: a
 * picture twice the frame at zoom 2 around an off-centre focal point cuts a frame-sized region, so
 * the extract offsets are pinned and the resample is still the identity. `single-photo-focal` pins
 * the band moved to the top for a focal point under it. Only the PNG hash is pinned: the SVG embeds
 * sharp's PNG encoding of each picture, which is a property of the zlib build rather than of the
 * slide.
 */
export declare const DNESKAI_GOLDEN_PATH: string;
/**
 * A deterministic stand-in photograph: two gradients and a block grid, from integer arithmetic.
 *
 * Bright at the top and in its blocks, so a slide that sets words over it without a shade would
 * be visibly wrong in the render a reviewer opens, not only in the contrast check.
 */
export declare function syntheticPhoto(width: number, height: number, seed: number): Promise<Buffer>;
/** The pinned slides. Every sentence is invented and says so; a baseline is not an article. */
export declare function dneskaiGoldenCases(): Promise<Array<{
    name: string;
    input: DneskaiSlideInput;
}>>;
export declare const DneskaiGoldenSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"dneskai-photo-golden/1">;
    canvas: z.ZodObject<{
        width: z.ZodLiteral<1080>;
        height: z.ZodLiteral<1350>;
    }, z.core.$strip>;
    updatedAt: z.ZodString;
    entries: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        templateId: z.ZodString;
        version: z.ZodString;
        pngHash: z.ZodString;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type DneskaiGolden = z.infer<typeof DneskaiGoldenSchema>;
/** Render every pinned slide. Throws if one is refused: a golden case is a slide that ships. */
export declare function buildDneskaiGolden(updatedAt: string): Promise<DneskaiGolden>;
export declare function readDneskaiGolden(): DneskaiGolden;
//# sourceMappingURL=dneskai-golden.d.ts.map