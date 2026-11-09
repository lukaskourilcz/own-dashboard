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
/**
 * The finished closing slide (owner, evening of 8 November 2026: the kit-drawn closing slide looked poor). One
 * 1080 × 1350 card, the same in every kit: the city from the Higgsfield picture without its window frame, in black and white, "SLEDUJ"
 * in Poppins Black (the logotype's face) and the DNESKAi logotype itself under it (white DNESK, icy blue Ai, the K never
 * tinted; owner, 9 November 2026), the follow line and the handle in a white outlined pill. The render draws this file instead of laying the
 * slide out in the deck's kit; its source is `closing-card-source/card.html` next to it.
 */
export const DNESKAI_CLOSING_CARD_SHA256 = "51ef2d195d070d2fca87f795e2d549036fe73be9aa52896e8f544f671dca0998";
export const DNESKAI_CLOSING_CARD_FILE = ["templates", "carousel-studio", "brand-kits", "caught-up", "dneskai-closing-card.png"] as const;
export const DNESKAI_CLOSING_CARD_TEMPLATE = { id: "dneskai-closing-card", version: "1.0.0" } as const;
export type DneskaiClosingWords = { headline: string; body: string; handle: string };
export const DNESKAI_CLOSING_DEFAULTS: DneskaiClosingWords = {
  headline: "Sleduj",
  body: "pro všechny novinky ze světa AI a technologií.",
  handle: "@dneskai",
};
export const DNESKAI_CLOSING_HEADLINE = `${DNESKAI_CLOSING_DEFAULTS.headline} [[DNESKAi]]`;
export const DNESKAI_CLOSING_BODY = `${DNESKAI_CLOSING_DEFAULTS.body} ${DNESKAI_CLOSING_DEFAULTS.handle}`;

/** The closing slide, with the owner's words from the Design Lab when given (9 November 2026). */
export function dneskaiClosingSlide(words?: { headline: string; body: string; handle: string }): DneskaiSlide {
  return {
    type: "figure",
    headline: words ? `${words.headline} [[DNESKAi]]` : DNESKAI_CLOSING_HEADLINE,
    body: words ? `${words.body} ${words.handle}` : DNESKAI_CLOSING_BODY,
    images: [{ slot: "image-1", assetSha256: DNESKAI_CLOSING_SHA256 }],
    alt: "Závěrečný snímek DNESKAi: noční město s modrými světly a výzva sledovat DNESKAi pro novinky ze světa AI a technologií.",
  };
}

/** Whether a slide is the closing slide: its picture is the closing picture. */
export const isDneskaiClosingSlide = (slide: Pick<DneskaiSlide, "images">): boolean =>
  slide.images.some((image) => image.assetSha256 === DNESKAI_CLOSING_SHA256);
