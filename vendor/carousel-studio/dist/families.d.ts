import { type CarouselTemplate } from "./schema.js";
import { type DeckFamily } from "./designs.js";
import { type Role } from "./family-kit.js";
/**
 * The template family library: what it contains, and how one family becomes a deck.
 *
 * The five deck styles the families join are one design wearing five coats — `mesh`, `aurora` and
 * `spotlight` are the same blurred-radial-blob primitive, and on MMA Files' greys, three tones
 * about 3% of luminance apart, the non-accent blobs are invisible. Only `contrast` and
 * `editorial` are structurally different from each other. A family differs from its neighbours in
 * composition: where the photograph sits and what shape it is cut to, where the type block lives,
 * what the frame is made of. Change the palette and it is still a different layout, which is the
 * whole point.
 *
 * Three things every family carries:
 *
 * - a **rhythm**, a repeating beat pattern the body slides walk, so two adjacent slides are never
 *   the same picture with different words;
 * - real **variants**, not the empty array `articleDeckTemplate` declares — A and B differ in the
 *   accent *and* in the ground, so a queued A/B pair is two byte streams rather than two
 *   filenames of one;
 * - **per-band type ceilings**, because a cover line, a passage and a closing line are three
 *   different reading distances.
 *
 * ## One slides array, one master canvas, three derivations
 *
 * `carousel-template/1` holds one set of layers and four canvas measurements, and a `canvas` block
 * saying which of them the composition was made for. Every family here declares all four —
 * 4:5 as the master and the other three derived — so a family's fractions have to hold at 1:1,
 * 4:5, 9:16 and the Threads square at once. Every text and logo frame therefore lives inside the
 * union of the four safe areas — the story's, which is the widest — and only backgrounds,
 * photographs and full-bleed art are allowed outside it. That is
 * a real constraint and it shows: a 4:5 deck from these families is more generously margined than
 * one composed for 4:5 alone. What it buys is that every family renders honestly as a story
 * without a second composition to keep in step.
 *
 * ## Where a composer lives
 *
 * Not here. This file assembles the record and builds a deck from it; the compositions sit in
 * `families-founding.ts` (the delivery's ten) and in `families-poster.ts`, `families-print.ts`
 * and `families-system.ts` (the 2026-08-10 expansion's thirteen, grouped by the trend each draws
 * on). Every primitive they share is in `family-kit.ts`.
 *
 * The split is rule 8's 400-line cap. Twenty-three compositions and the deck builder in one file
 * is a file nobody can hold in their head, which is the cap's own stated reason: every file on
 * its named-debt list has had a bug that survived review because the reviewer could not.
 */
/** What a family does with the article's photograph, which is how the Lab groups them. */
export declare const FAMILY_SERVES: Readonly<Record<DeckFamily, "photo-forward" | "type-only" | "quiet">>;
/** The reference a stored recipe or pack names for one family at one length. */
export declare function familyTemplateId(family: DeckFamily, slideCount: number): string;
/**
 * What the slide at this position is for, in this family.
 *
 * Exported because it is the whole of the hook's blast radius, and a rule nobody can read is a
 * rule nobody can check. Slide two is a `hook` only in the five families the dealer actually
 * deals; every legacy family keeps `body` there and therefore renders the byte-identical deck it
 * rendered before the role existed, which matters because a stored recipe naming one of them has
 * to redraw exactly as it was sent. `studio/tests/fixtures/legacy-family-hashes.json` is the
 * receipt for that claim, captured from the build before this role was added.
 */
export declare function deckSlideRole(family: DeckFamily, index: number, slideCount: number): Role;
/**
 * The axes a recipe turns, over and above which family it picked.
 *
 * `typeScale` moves every ceiling and floor in the family together, so a deck can be set louder
 * or quieter without a second composition. `phaseSeed` rotates the rhythm, so two articles in the
 * same family do not open on the same beat. `treatment` rides along on the image layers, which is
 * where the renderer reads it.
 */
export interface FamilyOptions {
    typeScale?: number;
    phaseSeed?: number;
    treatment?: "none" | "mono" | "duotone";
}
/**
 * One family, sized to the article.
 *
 * Cover, body beats, closing slide — the same arc `articleDeckTemplate` builds, with the family's
 * own composition and its rhythm walking the body. The slots are `slide-01`… as everywhere else,
 * so a payload built for one family renders in any of them.
 */
export declare function familyDeckTemplate(family: DeckFamily, slideCount: number, options?: FamilyOptions): CarouselTemplate;
/** Every family at every deck length the splitter can produce. Built on first use. */
export declare function familyDeckTemplates(): readonly CarouselTemplate[];
//# sourceMappingURL=families.d.ts.map