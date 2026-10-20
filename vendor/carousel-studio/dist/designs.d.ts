/**
 * The names of every deck design, and nothing else.
 *
 * A leaf module on purpose. The library builds templates from families, the recipe names families
 * and styles, and the library resolves a recipe's id — three files that need the same handful of
 * constants and would otherwise import each other in a ring. A ring of `export const` arrays is
 * not a design problem, it is a module-initialisation crash: whichever file loses the race reads
 * an uninitialised binding.
 */
/**
 * The five original deck designs.
 *
 * Kept, and kept resolvable: stored packs name `deck-mesh-5` through `deck-spotlight-10`, and an
 * owner override recorded before the families existed names one of these. They are one design in
 * five coats — `mesh`, `aurora` and `spotlight` are the same blurred-radial-blob primitive — which
 * is why nothing new derives them, but a recorded choice still binds.
 */
export declare const DECK_STYLES: readonly ["mesh", "editorial", "spotlight", "contrast", "aurora"];
export type DeckStyle = (typeof DECK_STYLES)[number];
/**
 * The template families, which is what the engine draws from now.
 *
 * The founding ten of `docs/design-lab/SPEC.md` first, then the 2026-08-10 expansion in the order
 * its concepts were built. Order is not cosmetic: `chooseFamily` ranks the pool by how long each
 * name has gone unused and breaks ties on the name, and the chip row in the Lab reads top to
 * bottom off this array. Appending is safe; reordering re-deals every unpinned recipe.
 */
export declare const DECK_FAMILIES: readonly ["masthead", "gutter", "bevel", "porthole", "slab", "terrace", "figure", "pull", "tower", "dossier", "billboard", "broadsheet", "zurich", "concrete", "terminal", "marginalia", "memo", "versus", "tally", "counterweight", "throughline", "quiet", "offset", "apex", "rail", "vista", "fault", "halo", "folio", "press"];
export type DeckFamily = (typeof DECK_FAMILIES)[number];
/**
 * The rotation: the only families the dealer deals unprompted.
 *
 * The owner's 2026-08-29 instruction, verbatim in spirit: always five ways to ship a carousel,
 * not twenty-four. The other families stay registered above because a stored recipe or pack that
 * names one must keep rendering forever — retiring a family from the rotation and deleting it are
 * different acts, and only the first is reversible. A live preset pool still overrides this list,
 * because a pool is the owner narrowing further, not wider.
 */
export declare const LAUNCH_FAMILIES: readonly ["folio", "press", "rail", "fault", "halo"];
/** Everything a recipe's `family` field may name. */
export declare const DECK_DESIGNS: readonly ["masthead", "gutter", "bevel", "porthole", "slab", "terrace", "figure", "pull", "tower", "dossier", "billboard", "broadsheet", "zurich", "concrete", "terminal", "marginalia", "memo", "versus", "tally", "counterweight", "throughline", "quiet", "offset", "apex", "rail", "vista", "fault", "halo", "folio", "press", "mesh", "editorial", "spotlight", "contrast", "aurora"];
export type DeckDesign = (typeof DECK_DESIGNS)[number];
export declare function isDeckFamily(value: string): value is DeckFamily;
export declare function isDeckStyle(value: string): value is DeckStyle;
//# sourceMappingURL=designs.d.ts.map