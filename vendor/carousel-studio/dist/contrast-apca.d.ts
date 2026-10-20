import type { BrandTokens, CarouselTemplate } from "./schema.js";
import type { TemplateCheck } from "./validation.js";
/** Screen luminance of an `#rrggbb` colour, on APCA's own transfer curve rather than WCAG's. */
export declare function apcaLuminance(hex: string): number;
/**
 * Signed lightness contrast: positive for dark text on a light ground, negative for the reverse.
 *
 * The sign is the whole point of the measure and is kept rather than discarded at the source, so a
 * caller that wants to know which polarity a slide is in can ask. `apcaLc` is the magnitude.
 */
export declare function apcaContrast(foregroundHex: string, backgroundHex: string): number;
/** The magnitude of the lightness contrast, which is what a floor is compared against. */
export declare function apcaLc(foregroundHex: string, backgroundHex: string): number;
/**
 * The floor every text and logo pair in a template must clear.
 *
 * 40, and it is a measured number rather than a borrowed one. Across the committed library — 30
 * shared families, every deck length the splitter resolves, all 9 brands, every rendering
 * including each variant: 70,875 pairs — the worst measures **Lc 41.2**, and nothing falls below
 * 40. That pair is Door Money's `#ff4d3d` accent on its `#24191c` surface, which clears WCAG at
 * 5.18:1 and is exactly the kind of saturated-on-near-black pairing the ratio flatters and the
 * lightness measure does not.
 *
 * 40 is therefore the highest round level the whole library clears: it refuses a composition that
 * reads worse than anything shipped today, and fails nothing that already ships. It is
 * deliberately not APCA's published body-text level — 11% of the library's pairs sit below Lc 60
 * and 29% below Lc 75 — because a floor nothing can pass is a floor somebody deletes. Closing
 * that gap is design work on the dark skins' quiet accents, recorded as an owner item; raising
 * this number afterwards is a fix. Lowering it to admit a new layout is not, and this paragraph
 * exists to make that awkward.
 */
export declare const APCA_MIN_LC = 40;
/** The worst pair in a template under this brand, for a report rather than a verdict. */
export declare function worstApcaLc(template: CarouselTemplate, brand: BrandTokens): number;
/**
 * Whether every set of words in this template clears the lightness floor, for this brand.
 *
 * Reads `textGroundPairs`, which is also what `contrastCheck` reads, so the two measures can never
 * disagree about what is behind a given line of type — only about how legible it is.
 */
export declare function apcaCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck;
//# sourceMappingURL=contrast-apca.d.ts.map