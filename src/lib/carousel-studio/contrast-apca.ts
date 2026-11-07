/**
 * APCA lightness contrast, alongside — never instead of — the WCAG 2.x floor.
 *
 * ## Why a second measure at all
 *
 * WCAG 2.x's 4.5:1 is a ratio of relative luminance and it is polarity-blind: it gives light type
 * on a dark ground and dark type on a light one the same number, although a reader does not see
 * them the same way. Every venture skin but two in this studio is dark, so the studio is exactly
 * the case the ratio is weakest at. APCA measures perceived lightness difference and is
 * polarity-sensitive, so it can catch a pair that clears 4.5:1 and still reads as grey on grey.
 *
 * It does not replace anything. `contrastCheck` keeps the 4.5:1 floor and keeps failing below it;
 * this check adds a second floor a pair must also clear. Two floors are strictly stricter than
 * one, which is the only direction a gate may move.
 *
 * ## Why the arithmetic is here rather than in a dependency
 *
 * The issue names `apca-w3` as the package to use after its licence is read. This repository does
 * not add npm dependencies for this work, so the algorithm is implemented here from the published
 * APCA-W3 0.1.9 (`0.98G-4g`) constant set rather than vendored. Two consequences are stated rather
 * than assumed: this file is not Myndex's code and carries none of its licence, and it is not an
 * APCA conformance implementation — it is this studio's own reading of the published constants,
 * used as an internal quality floor. Nothing here may be published as an APCA conformance claim.
 *
 * ## Why the thresholds are not the published bronze-tier numbers
 *
 * APCA's readability levels are stated in CSS reference pixels, and a template's font sizes are in
 * canvas pixels on a 1080-wide frame that a phone feed shows at roughly a third of that. Mapping
 * one to the other needs an assumed viewport, and an assumed viewport is a number nobody measured.
 * So the size rows are not used: every text and logo pair is held to one floor, `APCA_MIN_LC`,
 * chosen as the level the committed library actually clears — recorded in `docs/design-lab/TOKENS.md`
 * with the measurement that set it. A composition that reads worse than everything shipped today
 * fails; the floor rises when the library does, never the other way.
 */
import { textGroundPairs } from "./grounds.js";
import type { BrandTokens, CarouselTemplate } from "./schema.js";
// Type-only, so nothing here is a runtime edge back into the checks that call this one.
import type { TemplateCheck } from "./validation.js";

/**
 * The APCA-W3 0.1.9 (`0.98G-4g`) constant set.
 *
 * Named exactly as the published set names them so a reader can compare the two side by side.
 */
const APCA = {
  mainTRC: 2.4,
  sRco: 0.2126729,
  sGco: 0.7151522,
  sBco: 0.0721750,
  normBG: 0.56,
  normTXT: 0.57,
  revTXT: 0.62,
  revBG: 0.65,
  blkThrs: 0.022,
  blkClmp: 1.414,
  scaleBoW: 1.14,
  scaleWoB: 1.14,
  loBoWoffset: 0.027,
  loWoBoffset: 0.027,
  loClip: 0.1,
  deltaYmin: 0.0005
} as const;

/** Screen luminance of an `#rrggbb` colour, on APCA's own transfer curve rather than WCAG's. */
export function apcaLuminance(hex: string): number {
  const channel = (offset: number) => (Number.parseInt(hex.slice(offset, offset + 2), 16) / 255) ** APCA.mainTRC;
  return APCA.sRco * channel(1) + APCA.sGco * channel(3) + APCA.sBco * channel(5);
}

/**
 * Signed lightness contrast: positive for dark text on a light ground, negative for the reverse.
 *
 * The sign is the whole point of the measure and is kept rather than discarded at the source, so a
 * caller that wants to know which polarity a slide is in can ask. `apcaLc` is the magnitude.
 */
export function apcaContrast(foregroundHex: string, backgroundHex: string): number {
  let textY = apcaLuminance(foregroundHex);
  let backgroundY = apcaLuminance(backgroundHex);
  if (!Number.isFinite(textY) || !Number.isFinite(backgroundY)) return 0;
  // Black levels are clamped before anything is subtracted: below the threshold the eye stops
  // resolving difference, and without this two near-blacks report a contrast they do not have.
  if (textY <= APCA.blkThrs) textY += (APCA.blkThrs - textY) ** APCA.blkClmp;
  if (backgroundY <= APCA.blkThrs) backgroundY += (APCA.blkThrs - backgroundY) ** APCA.blkClmp;
  if (Math.abs(backgroundY - textY) < APCA.deltaYmin) return 0;
  if (backgroundY > textY) {
    const sapc = (backgroundY ** APCA.normBG - textY ** APCA.normTXT) * APCA.scaleBoW;
    return (sapc < APCA.loClip ? 0 : sapc - APCA.loBoWoffset) * 100;
  }
  const sapc = (backgroundY ** APCA.revBG - textY ** APCA.revTXT) * APCA.scaleWoB;
  return (sapc > -APCA.loClip ? 0 : sapc + APCA.loWoBoffset) * 100;
}

/** The magnitude of the lightness contrast, which is what a floor is compared against. */
export function apcaLc(foregroundHex: string, backgroundHex: string): number {
  return Math.abs(apcaContrast(foregroundHex, backgroundHex));
}

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
export const APCA_MIN_LC = 40;

/** The worst pair in a template under this brand, for a report rather than a verdict. */
export function worstApcaLc(template: CarouselTemplate, brand: BrandTokens): number {
  const pairs = textGroundPairs(template, brand);
  if (!pairs.length) return Number.POSITIVE_INFINITY;
  return Math.min(...pairs.map((pair) => Math.min(...pair.grounds.map((ground) => apcaLc(pair.foreground, ground)))));
}

/**
 * Whether every set of words in this template clears the lightness floor, for this brand.
 *
 * Reads `textGroundPairs`, which is also what `contrastCheck` reads, so the two measures can never
 * disagree about what is behind a given line of type — only about how legible it is.
 */
export function apcaCheck(template: CarouselTemplate, brand: BrandTokens): TemplateCheck {
  const failures = new Set<string>();
  let worstOverall = Number.POSITIVE_INFINITY;
  for (const pair of textGroundPairs(template, brand)) {
    const worst = Math.min(...pair.grounds.map((ground) => apcaLc(pair.foreground, ground)));
    worstOverall = Math.min(worstOverall, worst);
    if (worst < APCA_MIN_LC) failures.add(`${pair.slideId}:${pair.target}`);
  }
  if (failures.size) {
    return {
      id: "apca",
      status: "fail",
      detail: `APCA lightness contrast below Lc ${APCA_MIN_LC} at ${[...failures].join(", ")}`
    };
  }
  const measured = Number.isFinite(worstOverall) ? worstOverall.toFixed(1) : "n/a";
  return {
    id: "apca",
    status: "pass",
    detail: `APCA lightness contrast clears Lc ${APCA_MIN_LC}; worst pair Lc ${measured}`
  };
}
