export const DNESKAI_KIT_IDS = ["editorial", "bold", "explainer", "magazine", "ticker"];
export const DNESKAI_DEFAULT_KIT = "editorial";
export const DNESKAI_SLIDE_TYPES = ["cover-photo", "figure", "split", "statement", "sources", "single"];
/** The variants each slide type takes: today's table from `resolveTemplate`, shared by every kit. */
export const DNESKAI_VARIANTS = { "cover-photo": [], figure: [], split: [], statement: ["accent", "ink"], sources: [], single: ["photo", "type"] };
/** The template variant id a statement's `ink` writes into the payload. */
export const DNESKAI_INK_VARIANT = "INK";
export const DNESKAI_MAX_SOURCES = 4;
export const DNESKAI_MAX_THUMBNAILS = 6;
export const dneskaiSourceSlot = (index) => `source-${index + 1}`;
/** The compositions a kit implements. Sources is one role with seven templates, 0 to 6 thumbnails. */
export const DNESKAI_TEMPLATE_ROLES = ["cover-photo", "figure", "split", "split-pair", "statement", "sources", "single-photo", "single-type"];
/** Which role a slide resolves to, and for sources how many thumbnails. Today's rules, kit-independent. */
export function dneskaiRoleOf(type, variant, imageSlots) {
    if (!Object.hasOwn(DNESKAI_VARIANTS, type))
        throw new Error(`Unknown DNESKAi slide type ${type}`);
    if (variant !== undefined && !DNESKAI_VARIANTS[type].includes(variant))
        throw new Error(`Invalid ${type} variant ${variant}`);
    return { role: type === "single" ? (variant === "type" ? "single-type" : "single-photo") : type === "split" && imageSlots.includes("image-2") ? "split-pair" : type, thumbnails: type === "sources" ? Math.min(imageSlots.length, DNESKAI_MAX_THUMBNAILS) : 0 };
}
export const DNESKAI_TEXT_FIELDS = ["headline", "body", "kicker", "credit", "sources"];
/** Slots code writes: never a field OwnDashboard gates. */
export const DNESKAI_CODE_OWNED_SLOTS = ["folio", "title", "images-label", "disclosure"];
/**
 * The character limit of every text slot of every role, which every kit's templates must set
 * exactly. One deck written inside these limits sets without clipping in all five kits, because
 * each kit's frames pass the overflow gate at these limits. Today's editorial values.
 */
export const DNESKAI_TEXT_LIMITS = {
    "cover-photo": { headline: 110, kicker: 56, credit: 80 },
    figure: { folio: 9, headline: 110, body: 260, credit: 80 },
    split: { folio: 9, kicker: 28, headline: 110, body: 330, credit: 80 },
    "split-pair": { folio: 9, kicker: 28, headline: 110, body: 320, credit: 80 },
    statement: { folio: 9, headline: 170, body: 240 },
    sources: { folio: 9, title: 30, "source-1": 190, "source-2": 190, "source-3": 190, "source-4": 190, "images-label": 40, disclosure: 200 },
    "single-photo": { headline: 110, body: 100, kicker: 44, credit: 30 },
    "single-type": { kicker: 56, headline: 120, body: 280, credit: 80 }
};
/** The image slots a role carries, each with its `optional` flag; sources carries `image-1` to `image-N`, all required. */
export function dneskaiImageSlots(role, thumbnails = 0) {
    if (role === "sources")
        return Array.from({ length: thumbnails }, (_, n) => ({ slot: `image-${n + 1}`, optional: false }));
    if (role === "statement" || role === "single-type")
        return [];
    return [{ slot: "image-1", optional: false }, ...(role === "split-pair" ? [{ slot: "image-2", optional: false }] : [])];
}
/** The slide variant ids a role's template declares: statement `["INK"]`, every other role `[]`. */
export const DNESKAI_TEMPLATE_VARIANTS = Object.fromEntries(DNESKAI_TEMPLATE_ROLES.map(role => [role, role === "statement" ? ["INK"] : []]));
//# sourceMappingURL=contract.js.map