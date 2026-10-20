import { type FamilySpec } from "./family-kit.js";
import type { DeckFamily } from "./designs.js";
/**
 * Type as the whole image.
 *
 * The families here draw on the one finding every 2026 typography survey agreed on — that
 * typography-led minimalism is what a feed rewards, and that the hierarchy is the decoration.
 * They differ from each other in *which* typographic axis carries the composition: scale
 * (`billboard`), the grid and the void around it (`zurich`).
 *
 * A face is never named. `fontToken` resolves through the brand, so a family that expressed a
 * trend by asking for a condensed grotesque would be a family that only works for two of the five
 * ventures. What is portable is scale, weight, case, tracking and where the block sits.
 */
export declare const POSTER_FAMILIES: Readonly<Record<Extract<DeckFamily, "billboard" | "zurich" | "tally" | "counterweight">, FamilySpec>>;
//# sourceMappingURL=families-poster.d.ts.map