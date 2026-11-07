import { MASTER_CANVAS, MASTER_FORMAT } from "./canvas";
import type { CarouselTemplate } from "./schema";

/**
 * Hand placement of a DNESKAi slide's words (Design Studio, owner decision of 7 November 2026). The kit lays a slide
 * out automatically; the owner may then move a field's frame, change its width and its size, and align it. A box is
 * in master pixels (1080 × 1350), the same shape as a devShark box, so one editor serves both brands.
 *
 * A box replaces the laid-out frame of the field's text layer after the kit's layout: the frame starts at `x, y`, is
 * `w` wide and reaches down to the foot of the slide, the words stand at its top in exactly `size` px, and `align`
 * sets them. Under a moved headline, the quotation marks (code-owned) move with it. Nothing else on the slide moves:
 * the photographs and their shade stay where the kit put them. Without boxes the slide is byte-identical to before.
 */
export const DNESKAI_EDITABLE_FIELDS = ["headline", "body", "kicker"] as const;
export type DneskaiEditableField = (typeof DNESKAI_EDITABLE_FIELDS)[number];
export interface DneskaiBox { x: number; y: number; w: number; size: number; align: "left" | "center" | "right" }
export type DneskaiBoxes = Partial<Record<DneskaiEditableField, DneskaiBox>>;

/** One text block as drawn: the field, its frame in master pixels and its type, for the editor's overlay. */
export interface DneskaiLaidBlock { field: DneskaiEditableField; box: DneskaiBox; height: number }

const W = MASTER_CANVAS.width;
const H = MASTER_CANVAS.height;
const ALIGN_TO = { left: "start", center: "middle", right: "end" } as const;
const ALIGN_FROM = { start: "left", middle: "center", end: "right" } as const;
const MIN_WIDTH = 80;
const MIN_HEIGHT = 24;

type Layer = CarouselTemplate["slides"][number]["layers"][number];
type TextLayer = Extract<Layer, { type: "text" }>;
const isField = (slot: string): slot is DneskaiEditableField => (DNESKAI_EDITABLE_FIELDS as readonly string[]).includes(slot);
const clamp = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);

/** A box held on the canvas: the frame must stay inside it, so a box past an edge is pulled back to it. */
export function clampDneskaiBox(box: DneskaiBox): DneskaiBox {
  const w = clamp(Math.round(box.w), MIN_WIDTH, W);
  return { x: clamp(Math.round(box.x), 0, W - w), y: clamp(Math.round(box.y), 0, H - MIN_HEIGHT), w, size: clamp(Math.round(box.size), 16, 200), align: box.align };
}

/** The text layers' frames as the kit laid them out, as boxes: what the editor starts from. */
export function dneskaiAutoBoxes(template: CarouselTemplate): DneskaiLaidBlock[] {
  return template.slides[0]!.layers.flatMap((layer) => layer.type === "text" && isField(layer.slot)
    ? [{ field: layer.slot, height: layer.height * H, box: { x: layer.x * W, y: layer.y * H, w: layer.width * W, size: layer.maxFontSize, align: ALIGN_FROM[layer.align] } }]
    : []);
}

/** The slide's safe area in master pixels: the template checks refuse text outside it, so boxes are held inside. */
function safeArea(template: CarouselTemplate) {
  const safe = template.formats[MASTER_FORMAT]?.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 };
  return { left: Math.ceil(safe.left * W), top: Math.ceil(safe.top * H), right: Math.floor((1 - safe.right) * W), bottom: Math.floor((1 - safe.bottom) * H) };
}

/** A box held inside the slide's safe area. */
function inside(box: DneskaiBox, area: ReturnType<typeof safeArea>): DneskaiBox {
  const w = clamp(Math.round(box.w), MIN_WIDTH, area.right - area.left);
  return { ...clampDneskaiBox(box), w, x: clamp(Math.round(box.x), area.left, area.right - w), y: clamp(Math.round(box.y), area.top, area.bottom - MIN_HEIGHT) };
}

/**
 * The laid-out template with the owner's boxes applied. Fields the slide does not draw are ignored. `capacity` is how
 * many characters a placed frame holds at its size; the template checks require the field's limit to fit, so the
 * limit drops to it and longer copy is cut and refused as clipped rather than failing the template.
 */
export function applyDneskaiBoxes(template: CarouselTemplate, boxes: DneskaiBoxes | undefined, capacity?: (layer: TextLayer) => number): CarouselTemplate {
  if (!boxes || !Object.keys(boxes).length) return template;
  const slide = template.slides[0]!;
  const area = safeArea(template);
  const headline = slide.layers.find((layer): layer is TextLayer => layer.type === "text" && layer.slot === "headline");
  const moved = headline && boxes.headline ? inside(boxes.headline, area) : null;
  const layers = slide.layers.map((layer): Layer => {
    if (layer.type !== "text") return layer;
    if (layer.slot === "quote-mark" && moved && headline) {
      const x = clamp(layer.x + moved.x / W - headline.x, area.left / W, area.right / W - layer.width), y = clamp(layer.y + moved.y / H - headline.y, area.top / H, area.bottom / H - layer.height);
      return { ...layer, x, y };
    }
    const box = isField(layer.slot) ? boxes[layer.slot] : undefined;
    if (!box) return layer;
    const placed = inside(box, area);
    // The size is fixed, so the fitter never shrinks it: a field that no longer fits is cut and refused as clipped.
    const next = { ...layer, x: placed.x / W, y: placed.y / H, width: placed.w / W, height: (area.bottom - placed.y) / H, minFontSize: Math.min(placed.size, 160), maxFontSize: placed.size, maxLines: 12, align: ALIGN_TO[placed.align], valign: "top" } as TextLayer;
    return capacity ? { ...next, maxChars: clamp(Math.min(layer.maxChars, capacity(next)), 1, 1_000) } : next;
  });
  return { ...template, slides: [{ ...slide, layers }, ...template.slides.slice(1)] };
}

export const DNESKAI_BOX_LIMITS = { width: W, height: H, minWidth: MIN_WIDTH, minHeight: MIN_HEIGHT } as const;
