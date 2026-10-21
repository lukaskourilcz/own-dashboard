import { type FamilySpec } from "./family-kit.js";
import type { DeckFamily } from "./designs.js";
/**
 * Structure as the message.
 *
 * Where the poster families let scale carry a slide and the print families borrow a page's
 * furniture, these build the slide out of blocks, rows and continuity — the composition is a
 * system the reader can see working, and the type sits inside it.
 *
 * All of them are type-only. That is not a shortfall: most editions arrive without a photograph,
 * and a family that cannot compose without one narrows the pool exactly when the pool is needed.
 */
export declare const SYSTEM_FAMILIES: Readonly<Record<Extract<DeckFamily, "concrete" | "terminal" | "versus" | "throughline" | "quiet">, FamilySpec>>;
//# sourceMappingURL=families-system.d.ts.map