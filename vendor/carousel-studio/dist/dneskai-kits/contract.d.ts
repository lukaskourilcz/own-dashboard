export declare const DNESKAI_KIT_IDS: readonly ["editorial", "bold", "explainer", "magazine", "ticker", "spotlight"];
export type DneskaiKitId = (typeof DNESKAI_KIT_IDS)[number];
export declare const DNESKAI_DEFAULT_KIT: DneskaiKitId;
export declare const DNESKAI_SLIDE_TYPES: readonly ["cover-photo", "figure", "split", "statement", "sources", "single"];
export type DneskaiSlideType = (typeof DNESKAI_SLIDE_TYPES)[number];
export type DneskaiVariant = "accent" | "ink" | "photo" | "type";
/** The variants each slide type takes: today's table from `resolveTemplate`, shared by every kit. */
export declare const DNESKAI_VARIANTS: Readonly<Record<DneskaiSlideType, readonly DneskaiVariant[]>>;
/** The template variant id a statement's `ink` writes into the payload. */
export declare const DNESKAI_INK_VARIANT = "INK";
export declare const DNESKAI_MAX_SOURCES = 4;
export declare const DNESKAI_MAX_THUMBNAILS = 6;
export declare const dneskaiSourceSlot: (index: number) => string;
/** The compositions a kit implements. Sources is one role with seven templates, 0 to 6 thumbnails. */
export declare const DNESKAI_TEMPLATE_ROLES: readonly ["cover-photo", "figure", "split", "split-pair", "statement", "sources", "single-photo", "single-type"];
export type DneskaiTemplateRole = (typeof DNESKAI_TEMPLATE_ROLES)[number];
/** Which role a slide resolves to, and for sources how many thumbnails. Today's rules, kit-independent. */
export declare function dneskaiRoleOf(type: DneskaiSlideType, variant: DneskaiVariant | undefined, imageSlots: readonly string[]): {
    role: DneskaiTemplateRole;
    thumbnails: number;
};
export declare const DNESKAI_TEXT_FIELDS: readonly ["headline", "body", "kicker", "credit", "sources"];
export type DneskaiTextField = (typeof DNESKAI_TEXT_FIELDS)[number];
/**
 * Slots code writes: never a field OwnDashboard gates. `folio` stays named so a template from before
 * the owner's 22 October 2026 decision still parses; no current template places it. `quote-mark`
 * is the pair of quotation marks a kit may set above a quoted headline (`DNESKAI_QUOTE_MARK`).
 */
export declare const DNESKAI_CODE_OWNED_SLOTS: readonly ["folio", "title", "images-label", "disclosure", "quote-mark"];
/** What the `quote-mark` slot holds in every locale: an opening and a closing double quotation mark. */
export declare const DNESKAI_QUOTE_MARK = "\u201C\u201D";
/**
 * The character limit of every text slot of every role, which every kit's templates must set
 * exactly and in this order. One deck written inside these limits sets without clipping in all
 * five kits, because each kit's frames pass the overflow gate at these limits.
 *
 * The owner's decision of 22 October 2026 shapes the table: no slide shows a page count (folio)
 * or a picture credit, which moves to the Instagram caption OwnDashboard writes; the cover photo
 * and the two single-image roles, each the first or only slide of a post, carry the headline
 * alone; only the split roles keep a kicker. `credit` is still a contract text field so callers
 * may keep sending it, but no template places it. OwnDashboard no longer builds sources slides;
 * the role keeps its templates so an older deck still renders.
 */
export declare const DNESKAI_TEXT_LIMITS: Readonly<Record<DneskaiTemplateRole, Readonly<Record<string, number>>>>;
/**
 * Extra image slots a kit may declare for a role, every one optional, after the role's shared
 * slots. A kit absent here carries exactly the shared slots. The spotlight cover takes a second
 * picture, drawn as a circular inset; without it the cover draws no circle. The slide API refuses
 * a slot the resolved template has no layer for (`image-unexpected`), so `image-2` on a cover is
 * accepted only by a kit listed here.
 */
export declare const DNESKAI_OPTIONAL_IMAGE_SLOTS: Readonly<Partial<Record<DneskaiKitId, Readonly<Partial<Record<DneskaiTemplateRole, readonly string[]>>>>>>;
/**
 * The image slots a role carries, each with its `optional` flag; sources carries `image-1` to
 * `image-N`, all required. Given a kit, the kit's optional slots for the role follow the shared ones.
 */
export declare function dneskaiImageSlots(role: DneskaiTemplateRole, thumbnails?: number, kit?: DneskaiKitId): readonly {
    slot: string;
    optional: boolean;
}[];
/** The slide variant ids a role's template declares: statement `["INK"]`, every other role `[]`. */
export declare const DNESKAI_TEMPLATE_VARIANTS: Readonly<Record<DneskaiTemplateRole, readonly string[]>>;
//# sourceMappingURL=contract.d.ts.map