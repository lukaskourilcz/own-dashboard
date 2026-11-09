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
  1728 × 2304 PNG) so only the city shows, in black and white (owner, 8 November 2026), fading into ink.
- Words (owner, 9 November 2026): "SLEDUJ" in white Poppins Black, the logotype's own face (OFL,
  `closing-card-source/poppins-900.ttf` with `Poppins-OFL.txt`), and under it the DNESKAi logotype itself from
  `DNESKAi-logo-dark.svg`: white DNESK, "Ai" in #6EC1FF drawn underneath so the K stays fully white; "pro všechny novinky ze světa AI
  a technologií." in Inter; "@dneskai" in white inside a white outlined pill with no fill, bottom right (owner, 8 November 2026: no "Instagram · Threads").
- Source: `closing-card-source/card.html` with `photo.jpg`, screenshot at 1080 × 1350 in Playwright Chromium.
  A new screenshot is not byte-identical, so a redraw changes the pinned hash.
- sha256 `51ef2d195d070d2fca87f795e2d549036fe73be9aa52896e8f544f671dca0998`, pinned in
  `src/lib/marketing/dneskai-closing.ts` (`DNESKAI_CLOSING_CARD_SHA256`). The deck still names the closing slide by
  the picture's hash above; the render sees that hash and draws the card.
