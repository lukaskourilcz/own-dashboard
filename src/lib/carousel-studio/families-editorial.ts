import { LEFT, MEASURE, TOP, drawnIndex, hero, hookMark, pagerDots, rule, shape, text, type Composer, type FamilySpec } from "./family-kit.js";

// Original compositions informed by the Canva carousel catalog's photo-feature and
// typography categories. No template assets or third-party compositions are embedded.
const mast = () => [
  { type: "logo" as const, x: LEFT, y: TOP, width: 0.52, height: 0.026, colorToken: "foreground", fontToken: "mono" as const },
  rule(LEFT, TOP + 0.055, MEASURE, { thickness: 2, colorToken: "muted" })
];

const folio: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  const footer = pagerDots(index, slideCount, ground);
  if (role === "cover") return [
    ...mast(),
    text(slot, LEFT, 0.24, MEASURE, 0.25, {
      fontWeight: 900, minFontSize: 32, maxFontSize: 112, maxChars: 140, maxLines: 5, tracking: -0.025
    }),
    shape(LEFT, 0.535, MEASURE, 0.225, { fillToken: "surface-strong" }),
    hero(LEFT, 0.535, MEASURE, 0.225, { scrim: "none" }),
    rule(LEFT, 0.77, 0.1, { thickness: 8 }),
    ...footer
  ];
  if (role === "outro") return [
    ...mast(),
    rule(LEFT, 0.29, 0.15, { thickness: 10 }),
    text(slot, LEFT, 0.36, MEASURE, 0.34, { fontWeight: 800, minFontSize: 32, maxFontSize: 106, maxLines: 6 }),
    ...footer
  ];
  if (role === "hook") {
    // The magazine's opening spread: the mark where the folio number would sit, the headline
    // block starting where the cover's does, and a ceiling between the cover's and the page's.
    return [
      ...mast(),
      ...hookMark(LEFT, 0.26, ground),
      text(slot, LEFT, 0.33, MEASURE, 0.42, { fontWeight: 700, minFontSize: 30, maxFontSize: 104, maxLines: 8 }),
      ...footer
    ];
  }
  return [
    ...mast(),
    ...drawnIndex(index + 1, LEFT, 0.24, 0.06, 0.105, 0.014, "accent"),
    ...(beat.step === 1 ? [hero(0.72, 0.235, 0.205, 0.135, { treatment: "mono", scrim: "none" })] : []),
    text(slot, LEFT, 0.4, MEASURE, 0.355, { fontWeight: 700, minFontSize: 30, maxFontSize: 82, maxLines: 8 }),
    ...footer
  ];
};

const press: Composer = ({ slot, index, slideCount, role, beat, ground }) => {
  const footer = pagerDots(index, slideCount, ground);
  if (role === "cover") return [
    // Owner reference: @technology's photograph-led covers and dense lower headlines.
    // The image fades into a solid text ground; retain each venture's own type and palette.
    shape(0, 0, 1, 0.53, { fillToken: "surface-strong" }),
    hero(0, 0, 1, 0.53, { scrim: "bottom" }),
    shape(0, 0.53, 1, 0.3, { fillToken: "background" }),
    { type: "logo", x: 0.32, y: 0.535, width: 0.36, height: 0.018, colorToken: "foreground", fontToken: "mono" },
    rule(0.46, 0.569, 0.08, { thickness: 5 }),
    text(slot, LEFT, 0.59, MEASURE, 0.20, {
      fontWeight: 900, minFontSize: 28, maxFontSize: 124, maxChars: 140, maxLines: 5, uppercase: true, tracking: -0.025, align: "middle"
    }),
    ...footer
  ];
  if (role === "outro") return [
    ...mast(),
    shape(LEFT, 0.27, 0.014, 0.45, { fillToken: "accent" }),
    text(slot, LEFT + 0.055, 0.32, MEASURE - 0.055, 0.39, { fontWeight: 900, minFontSize: 30, maxFontSize: 106, maxLines: 7 }),
    ...footer
  ];
  if (role === "hook") {
    // The second front page. No hairline dividing a page from the one before it, because a
    // re-served reader has no page before it — the entry mark opens, the headline runs heavy.
    return [
      ...mast(),
      ...hookMark(LEFT, 0.27, ground),
      text(slot, LEFT, 0.34, MEASURE, 0.41, { fontWeight: 900, minFontSize: 28, maxFontSize: 116, maxLines: 8 }),
      ...footer
    ];
  }
  return [
    ...mast(),
    ...drawnIndex(index + 1, LEFT, 0.255, 0.075, 0.13, 0.018, "accent"),
    rule(LEFT, 0.435, beat.step === 1 ? MEASURE : 0.2, { thickness: 3, colorToken: "muted" }),
    text(slot, LEFT, 0.48, MEASURE, 0.285, {
      fontWeight: beat.step === 1 ? 700 : 900, minFontSize: 28, maxFontSize: 92, maxLines: 8
    }),
    ...footer
  ];
};

export const EDITORIAL_FAMILIES: Readonly<Record<"folio" | "press", FamilySpec>> = {
  folio: { description: "Editorial folio: precise masthead, generous headline and a framed photograph; numbered reading pages.", compose: folio },
  press: { description: "Photo-led news: edge-to-edge hero, small branding and a dense centered headline; numbered body pages.", compose: press }
};
