import type { DneskaiSlide } from "./dneskai-slides";

/**
 * The closing slide every DNESKAi carousel ends with (owner decision, 8 November 2026). It is written by code, never by
 * the model, and it is the same on every post: the owner's Higgsfield picture (Seedream 4.5, generated in his account
 * on 8 November 2026; `templates/carousel-studio/brand-kits/caught-up/dneskai-closing.md`) and the line "Sleduj
 * DNESKAi pro všechny novinky ze světa AI a technologií." with the handle. The follow line is the owner's one exception
 * to the rule that no slide asks readers to follow.
 *
 * It is an ordinary `figure` slide, so every kit draws it in its own look, and its picture is not a media asset of the
 * brief: the deck names it by the file's sha256 and the render's media loader reads the file (`dneskaiClosingBytes`).
 */
export const DNESKAI_CLOSING_SHA256 = "23afb625077955c0e00bcedec70e01084501358cd8a61b61a3f9cbe903872a11";
export const DNESKAI_CLOSING_FILE = ["templates", "carousel-studio", "brand-kits", "caught-up", "dneskai-closing.jpg"] as const;
export const DNESKAI_CLOSING_HEADLINE = "Sleduj [[DNESKAi]]";
export const DNESKAI_CLOSING_BODY = "pro všechny novinky ze světa AI a technologií. @dneskai";

export function dneskaiClosingSlide(): DneskaiSlide {
  return {
    type: "figure",
    headline: DNESKAI_CLOSING_HEADLINE,
    body: DNESKAI_CLOSING_BODY,
    images: [{ slot: "image-1", assetSha256: DNESKAI_CLOSING_SHA256 }],
    alt: "Závěrečný snímek DNESKAi: noční město s modrými světly a výzva sledovat DNESKAi pro novinky ze světa AI a technologií.",
  };
}

/** Whether a slide is the closing slide: its picture is the closing picture. */
export const isDneskaiClosingSlide = (slide: Pick<DneskaiSlide, "images">): boolean =>
  slide.images.some((image) => image.assetSha256 === DNESKAI_CLOSING_SHA256);
