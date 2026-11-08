# dneskai-closing.jpg

The picture of the closing slide every DNESKAi carousel ends with (owner decision, 8 November 2026).

- Provider: Higgsfield, model Seedream 4.5, 3:4, Unlimited mode, generated in the owner's own Higgsfield account on
  8 November 2026 at his request ("poslední slide musí být fotka, kterou teď vygeneruj přes Higgsfield").
- Original: 1728 × 2304 PNG. This file is that picture cropped to 4:5 (72 px off the top and the bottom) and scaled
  to 1080 × 1350, JPEG quality 88.
- Prompt: a dark modern city street at blue hour seen from a high window, thin streams of electric blue light between
  the buildings, light rain, the lower half dark and empty for headline text; no people, text, letters, logos or signs.
- sha256 `23afb625077955c0e00bcedec70e01084501358cd8a61b61a3f9cbe903872a11`, pinned in
  `src/lib/marketing/dneskai-closing.ts`. The render refuses the file if its bytes change; replace both together.

## dneskai-closing-card.png (evening of 8 November 2026)

The owner found the kit-drawn closing slide poor ("je dost nešťastný"). Since then every carousel ends with this
finished 1080 × 1350 card instead, the same in Spotlight and Plakát:

- Picture: the same Higgsfield original, cropped inside the window frame (left 208, top 380, 1320 × 1173 of the
  1728 × 2304 PNG) so only the city shows, fading into ink.
- Words: "SLEDUJ" in white and "DNESKAi" in the brand's icy blue (#6EC1FF), Anton at 212 px; "pro všechny novinky ze světa AI
  a technologií." in Inter; a white "@dneskai" pill with "Instagram · Threads".
- Source: `closing-card-source/card.html` with `photo.jpg`, screenshot at 1080 × 1350 in Playwright Chromium.
  A new screenshot is not byte-identical, so a redraw changes the pinned hash.
- sha256 `295d3aad72b5ea70bc4f59725bbbffa5147bae07b317b1689ef320986a03f484`, pinned in
  `src/lib/marketing/dneskai-closing.ts` (`DNESKAI_CLOSING_CARD_SHA256`). The deck still names the closing slide by
  the picture's hash above; the render sees that hash and draws the card.
