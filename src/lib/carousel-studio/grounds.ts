/**
 * What the reader actually sees behind every set of words, resolved once for every measure.
 *
 * A leaf module, importing only the schema's types and `brand-kit.ts`, which imports nothing from
 * the studio — the ring-avoidance rule `canvas.ts` and `designs.ts` both state at their own tops.
 *
 * This logic used to live inside `contrastCheck`'s closure, and it had to come out the moment a
 * second readability measure arrived. Two measures that each resolve their own grounds are two
 * answers to "what is behind this line of type", and two answers drift: the WCAG floor would be
 * measuring a panel while APCA measured the slide background, and the pair that failed would be
 * the pair nobody looked at. `validation.ts` and `contrast-apca.ts` now read this one list and
 * differ only in the arithmetic they apply to it.
 */
import { chooseLogotypeVariant, logotypeForBrand, type KitLogotype } from "./brand-kit.js";
import type { BrandTokens, CarouselTemplate } from "./schema.js";

/** Source-over compositing of one colour on another, which is what the renderer draws. */
function composite(base: string, over: string, alpha: number): string {
  const parse = (value: string) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const [br, bg, bb] = parse(base);
  const [or, og, ob] = parse(over);
  const mix = (b: number, o: number) => Math.round(b * (1 - alpha) + o * alpha);
  return `#${[mix(br!, or!), mix(bg!, og!), mix(bb!, ob!)].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

/** Whether one frame sits entirely inside another. */
function contains(outer: Frame, inner: Frame): boolean {
  return outer.x <= inner.x
    && outer.y <= inner.y
    && outer.x + outer.width >= inner.x + inner.width
    && outer.y + outer.height >= inner.y + inner.height;
}

interface Frame { x: number; y: number; width: number; height: number }

/**
 * One text or logo frame, the colour it is drawn in, and everything that can end up behind it.
 *
 * The smallest size and the weight travel with the pair because a readability floor depends on
 * them: 4.5:1 is one number for every size, but APCA's is not, and a threshold chosen without the
 * type size is a threshold chosen for the wrong text. A logo carries the renderer's own floor —
 * 18 px at weight 800 — rather than a guess, because that is what `layerSvg` clamps it to.
 */
export interface TextGround {
  slideId: string;
  /** The slot name, or `logo`. Spelled exactly as a failing check reports it. */
  target: string;
  foreground: string;
  /** Every colour that can sit behind those words in this rendering. */
  grounds: string[];
  minFontSize: number;
  fontWeight: number;
}

/** The renderer's own lower bound for a wordmark: `Math.max(18, …)` at `LOGO_WEIGHT`. */
const LOGO_MIN_FONT_SIZE = 18;
const LOGO_FONT_WEIGHT = 800;

type Slide = CarouselTemplate["slides"][number];
type Layer = Slide["layers"][number];
type ImageLayer = Extract<Layer, { type: "image" }>;

/** The opacity of a vertical ramp at one point of its frame, held flat past its end stops. */
function rampAt(stops: ReadonlyArray<{ at: number; opacity: number }>, t: number): number {
  const first = stops[0]!;
  const last = stops.at(-1)!;
  if (t <= first.at) return first.opacity;
  if (t >= last.at) return last.opacity;
  for (let index = 1; index < stops.length; index += 1) {
    const from = stops[index - 1]!;
    const to = stops[index]!;
    if (t <= to.at) return to.at === from.at ? to.opacity : from.opacity + ((t - from.at) / (to.at - from.at)) * (to.opacity - from.opacity);
  }
  return last.opacity;
}

/** The weakest point of a ramp across a span: a ramp is linear between stops, so ends and stops. */
function weakestOf(stops: ReadonlyArray<{ at: number; opacity: number }>, from: number, to: number): number {
  const points = [from, to, ...stops.map((stop) => stop.at).filter((at) => at > from && at < to)];
  return Math.min(...points.map((t) => rampAt(stops, t)));
}

/** The renderer's own fading scrim, as a ramp: clear to 55 % of the frame, then to 0.96. */
const BOTTOM_SCRIM = [{ at: 0.55, opacity: 0 }, { at: 1, opacity: 0.96 }] as const;

/**
 * What a photograph puts behind a text frame, in a carousel-template/2 slide.
 *
 * The photograph's pixels are the article's, so both extremes stand in for them: a white picture
 * and a black one, each seen through whatever the layer draws over it at that drawing's weakest
 * point under the frame. A v2 slide that sets words on a bare photograph therefore fails, which
 * is the point — v1 measured such words against the slide's ground and passed a design no reader
 * could be promised.
 */
function photographGrounds(image: ImageLayer, layer: Layer, brand: BrandTokens, resolve: (name: string) => string | undefined): string[] {
  const span = (value: number) => (value - image.y) / image.height;
  const from = span(layer.y);
  const to = span(layer.y + layer.height);
  let seen = ["#ffffff", "#000000"];
  const scrim = brand.colors.background;
  if (scrim && image.scrim === "full") seen = seen.map((colour) => composite(colour, scrim, 0.55));
  if (scrim && image.scrim === "bottom") seen = seen.map((colour) => composite(colour, scrim, weakestOf(BOTTOM_SCRIM, from, to)));
  const ink = image.shade ? resolve(image.shade.colorToken) : undefined;
  if (image.shade && ink) {
    const alpha = weakestOf(image.shade.stops, from, to);
    seen = seen.map((colour) => composite(colour, ink, alpha));
  }
  return seen;
}

/** One rendering of a slide: which token is the ground and which the accent resolves to. */
export interface SlideRendering {
  background: string;
  accent: string;
}

/**
 * Every colour that can sit behind one layer of one slide in one rendering.
 *
 * What is actually behind these words. The slide background used to be the whole answer, and it
 * refused designs a reader finds perfectly legible: `background`-coloured type on an `accent`
 * panel measures 6.17:1 and was reported as 1.00:1, because an opaque shape drawn beneath the
 * text was invisible to the check. The last opaque layer before the text that covers its frame —
 * a panel, a gradient whose two stops are two grounds, or a duotone photograph, which runs from
 * black to its tint — is what the reader sees, so that is what is measured.
 *
 * In a carousel-template/1 slide an untreated photograph still cannot be checked: its pixels are
 * the article's, not the template's, and the slide relies on the scrim its image layer draws. A
 * carousel-template/2 slide is measured against the photograph's two extremes instead (see
 * `photographGrounds`), which is what lets a v2 template promise words over any picture.
 *
 * Exported because the renderer asks the same question when it picks which logotype file to draw,
 * and a second answer would be a logo checked against one ground and drawn on another.
 */
export function groundsBehindLayer(
  slide: Slide,
  layerIndex: number,
  brand: BrandTokens,
  rendering: SlideRendering,
  /** True for a carousel-template/2 slide: words over a photograph are measured against it. */
  options: { photographs?: boolean } = {}
): string[] {
  const resolve = (name: string) => brand.colors[name === "accent" ? rendering.accent : name];
  const background = brand.colors[rendering.background];
  if (!background) return [];
  const layer = slide.layers[layerIndex];
  if (!layer) return [];
  // A blob is composited over its ground at its own opacity, so that is what sits behind the
  // text — not the blob's full colour. Comparing against the raw colour fails designs a
  // reader would find perfectly legible, and a check that cries wolf gets its threshold
  // lowered by the next person, which is how a contrast floor quietly dies.
  const blobs = slide.layers.flatMap((candidate) =>
    candidate.type === "mesh"
      ? candidate.blobs.flatMap((blob) => {
          const colour = resolve(blob.colorToken);
          return colour ? [{ colour, opacity: blob.opacity }] : [];
        })
      : []
  );
  let ground = [background];
  for (const under of slide.layers.slice(0, layerIndex)) {
    if (!contains(under, layer)) continue;
    if (under.type === "shape") {
      const fill = resolve(under.fillToken);
      if (fill) ground = [fill];
    }
    if (under.type === "linear-gradient") {
      const stops = under.stops
        .map((stop) => resolve(stop.colorToken))
        .filter((colour): colour is string => colour !== undefined);
      if (stops.length) ground = stops;
    }
    if (under.type === "image" && under.treatment === "duotone" && under.scrim === "none") {
      const tint = resolve("accent");
      if (tint) ground = [tint, "#000000"];
    } else if (under.type === "image" && options.photographs && layer.type === "text") {
      // An optional photograph may be absent, so the words may also stand on what is under it.
      const seen = photographGrounds(under, layer, brand, resolve);
      ground = under.optional ? [...ground, ...seen] : seen;
    }
  }
  return [
    ...ground,
    ...blobs.flatMap((blob) => ground.map((base) => composite(base, blob.colour, blob.opacity)))
  ];
}

/**
 * Every text and logo frame in this template, once per rendering the slide can produce.
 *
 * A brand with an outlined logotype from its kit is measured for what the renderer will draw: an
 * approved file on a ground its spec names is the brand's decision and adds no pair, and a
 * one-colour fallback is measured in its own ink. `logotype` defaults to the brand's kit.
 */
export function textGroundPairs(
  template: CarouselTemplate,
  brand: BrandTokens,
  logotype: KitLogotype | null = logotypeForBrand(brand.id)
): TextGround[] {
  const pairs: TextGround[] = [];
  template.slides.forEach((slide) => {
    /*
     * Every rendering this slide can produce, not only its default one.
     *
     * A variant may swap the background or the accent, and the swapped rendering is what half a
     * queued A/B pair actually ships. Checking only the base is how "every token combination a
     * template can produce clears the floor" becomes "the one we happened to look at does".
     */
    const renderings: SlideRendering[] = [
      { background: slide.backgroundToken, accent: "accent" },
      ...slide.variants.map((variant) => ({
        background: variant.backgroundToken ?? slide.backgroundToken,
        accent: variant.accentToken ?? "accent"
      }))
    ];
    for (const rendering of renderings) {
      if (!brand.colors[rendering.background]) continue;
      slide.layers.forEach((layer, layerIndex) => {
        if (layer.type !== "text" && layer.type !== "logo") return;
        const candidates = groundsBehindLayer(slide, layerIndex, brand, rendering, { photographs: template.schemaVersion === "carousel-template/2" });
        let foreground = brand.colors[layer.colorToken === "accent" ? rendering.accent : layer.colorToken];
        if (!foreground) return;
        if (layer.type === "logo" && logotype) {
          const chosen = chooseLogotypeVariant(logotype, candidates, false);
          if (chosen?.exempt) return;
          if (chosen) foreground = chosen.variant.inks[0]!;
        }
        pairs.push({
          slideId: slide.id,
          target: layer.type === "text" ? layer.slot : "logo",
          foreground,
          grounds: candidates,
          minFontSize: layer.type === "text" ? layer.minFontSize : LOGO_MIN_FONT_SIZE,
          fontWeight: layer.type === "text" ? layer.fontWeight : LOGO_FONT_WEIGHT
        });
      });
    }
  });
  return pairs;
}
