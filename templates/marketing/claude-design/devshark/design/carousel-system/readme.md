# devShark carousel design system

devShark (devshark.app) is a learning platform for web developers: guided lessons, quizzes, server-graded coding tasks, a daily question, streaks and leaderboards. It has been freemium since 25 September 2026; Premium launches at €1.80 a month / €18 a year (regular €3.99 from 3 November 2026). devShark ships no AI feature and its copy makes no AI claims.

This system covers **social carousels for Instagram and Threads** (1080 × 1350) in the “Deep End v2” identity of the product: ocean ink, tactile paper, editorial type, one disciplined accent, the waterline mark, restrained fins.

## Sources
- Product repository: github.com/lukaskourilcz/react-express-app (main). Tokens from `client/src/styles/astryx-theme.css`; brand rules from `docs/brand/brand-guidelines.md` (V9 kit) and `docs/marketing/social-skill.md`; behavioural rules from `DESIGN_RULES.md`; code theme from `client/src/components/CodeBlock.tsx` (Prism One Dark); tech logos from `client/src/components/ui/techIcons.tsx` (devicon).
- Brand marks: the V9 kit (`client/public/brand/v9/recommended/`) — copied into `assets/`.
- The finished design: `Direction B - Mixed colours.dc.html` (two carousels: Premium launch offer, full run). Earlier explorations: `Direction A - Editorial paper`, `Direction B - Panel`, `Direction C - Waterline`.

## Content fundamentals
- **Voice**: a well-set magazine page, not a startup ad. Plain, matter-of-fact sentences. No hype, no exclamation marks, no emoji, no AI claims.
- **One idea per slide**, never more than ~25 words. Headlines are short declaratives with full stops: “Learn. Quiz. Code.” “Start with the foundations.”
- **Kickers** are two-to-four-word labels, uppercase in type but written normally: “How it works”, “Premium · launch price”. The middle dot separates two labels.
- **The name** is always “devShark” (lowercase d, capital S), even inside uppercase labels. It appears on the cover and the closing slide only; slides in between teach, they don’t sell.
- **Prices** are introductory launch prices, never sales: no “was/now”, no strikethrough without the words “regular price”. Dates are written “3 November 2026” in body copy and “2 Nov 2026” in a footer.
- **Numbers** lead: 770, 16, 55%, €1.80 — set very large and left to speak.
- Second person is implied, rarely written; “you” appears only where it clarifies (“tell you exactly what failed”).

## Visual foundations
- **Colour**: three backgrounds run through one carousel — pale `#F3F6F1`, ink `#0B141B`, green `#2D7A2D` (one green slide at most). Text is ink on pale, `#E8EEF0` on ink, white on green. The accent is `#2D7A2D` on pale and `#4CAF50` on ink; green text never sits on ink. Panels take the surface of their background (`#FFFFFF` / `#101C24`), and on green a white panel with ink type. The accent tint (`#E3EFE1`, dark: accent at 14%) highlights one row per slide at most. Tech chips take their logo’s brand colour at 14% over white.
- **Type**: Manrope 800 for everything display (headlines 104–112, hero statements 152, cover 80, big numbers 184), Manrope 700 for kickers and row markers, Inter 400/500 for body (44–46, footers 40), JetBrains Mono 400 for code (28 in the One Dark block). Tight display tracking (−0.015em; hero −0.025em; numbers −0.03em). Nothing under 40 px except code.
- **Layout**: 1080 × 1350; 80 px side/bottom margins; content box from y 168. Kicker → 40 → headline → 48 → panel. One surface panel per slide holds the key element; the headline stays outside. The cover has no panel — headline and statement share the same face and size. Footers sit on the bottom margin; on the cover “Swipe →” sits bottom-right in ink over the fin.
- **Backgrounds**: flat token colour plus the product’s paper grain (tiled noise at 4.5% alpha). No gradients, shadows, glass, neon, 3D, photos or illustrations.
- **Marks**: no corner fin — the horizontal logo, 400 px, appears on the closing slide only. A large kit fin surfaces from the bottom edge on open slides — green on pale and ink, ink on green — in four placements (big, small, huge, tucked), never the same twice in one carousel. Fins are never redrawn, rotated or recoloured; tip points left; base rides the bottom edge (rule 1 of DESIGN_RULES).
- **Waterline**: the kicker’s underline is the product’s 24 × 6 wave tile at 2× (48 × 12, stroke 3.2) in the accent colour, as long as the label. Eight tiles; neighbouring slides step by three (1, 4, 7, 2, 5, 8, 3, 6) so no two adjacent slides match.
- **Corners**: panels 16 px, tinted rows and the code block 12 px, chips pill. Hairline borders 1 px (`#D6DED3`; dark: white at 10%). No shadows.
- **Motion**: none in a static carousel. If animated, follow the product: opacity fades ≈350 ms, fins only ever rise from below, reduced-motion freezes everything.
- **Imagery**: none. Official devicon logos on the seven tech chips are the only pictures.

## Iconography
- No icon set. Unicode “✓” (Manrope 700, accent) marks checklist rows; “01 02 03” number steps; “→” ends “Swipe →”.
- Tech logos: devicon full-colour SVGs (html5, css3, javascript, typescript, react, nodejs; nextjs-plain is monochrome) — the same files the product’s `CategoryGlyph` bundles. In `assets/tech-*.svg`. Never recolour them.
- Brand marks: `assets/devshark-fin-clean-{green,white,ink}.svg`, `assets/devshark-logo-horizontal-{green,white,ink}.svg`. No other fins or logos exist; do not draw any.
- No emoji.

## Index
- `styles.css` → `tokens/` (`fonts.css`, `colors.css` with `[data-theme=dark|green]` scopes, `typography.css`, `spacing.css`, `marks.css` with the wave bank and grain).
- `guidelines/` — 18 specimen cards: Colors (brand, light, dark, green, tech tints, One Dark), Type (display, numbers, kicker, body, mono), Brand (corner fin, surfacing fin, waterline bank, grain, logos), Layout (slide anatomy, colour sequences).
- `components/carousel/` — Slide, Kicker, Headline (+ BigNumber, Statement, Accent, Footer, Logo), Panel (+ PanelRow, Body, TintRow), TechChip (+ ChipRow), CodeBlock (+ TestsPassed). Card: `carousel.card.html`.
- `ui_kits/carousel/` — `index.html` renders both carousels from `Carousel.jsx`; `new-post.html` is the starting point for a new post.
- `assets/` — V9 marks and devicon logos.
- `SKILL.md` — agent skill for Claude Code.
- `design_handoff_instagram_carousel_kit/` — developer handoff with the Claude Code prompt.

### Intentional additions
- `Statement`, `BigNumber`, `TintRow`, `TestsPassed` — carousel-only type/panel pieces with no product counterpart; they exist so the slides compose without inline numbers.
- The 14%-tint tech chips and the ink “No signup needed.” line are decisions made in this carousel, not in the product.

### Caveats
- Fonts load from Google Fonts (the product uses Fontsource variable fonts); metrics match.
- `--tint` on dark has no product token; the accent at 14% follows the product’s `--color-accent-muted` logic.
- Code is set at 28 px, below the 40 px slide minimum, by the owner’s decision.
