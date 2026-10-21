import { type FamilySpec } from "./family-kit.js";
import type { DeckFamily } from "./designs.js";
/**
 * The ten families of the founding delivery, from `docs/design-lab/SPEC.md`.
 *
 * Five of them are the photo-forward set and are the only families in the library that take a
 * photograph, which is why they stayed together when the 2026-08-10 expansion split the composers
 * into modules: what they share is a posture toward the article's hero, not a trend.
 *
 * They are also the reason the expansion had a bar to clear. The five deck *styles* they replaced
 * were one design in five coats — `mesh`, `aurora` and `spotlight` are the same blurred-radial-blob
 * primitive — and nothing in the suite compared two designs, so five wallpapers and an A/B pair
 * that shared one byte stream both passed every gate they had.
 */
export declare const FOUNDING_FAMILIES: Readonly<Record<Extract<DeckFamily, "masthead" | "gutter" | "bevel" | "porthole" | "slab" | "terrace" | "figure" | "pull" | "tower" | "dossier">, FamilySpec>>;
//# sourceMappingURL=families-founding.d.ts.map