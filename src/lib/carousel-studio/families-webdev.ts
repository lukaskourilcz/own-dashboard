import { CarouselTemplateSchema, type CarouselLayerInput, type CarouselTemplate } from "./schema.js";
import { deckCanvas, deckFormats } from "./library.js";

export const WEBDEV_SIGNAL_MIN_PANELS = 4;
export const WEBDEV_SIGNAL_MAX_PANELS = 6;
export const WEBDEV_SIGNAL_TEMPLATE_VERSION = "1.0.0";

export type WebDevSignalVisualStatus = "stable" | "preview" | "security" | "breaking" | "deprecated";

export function webDevSignalTemplateId(panelCount: number): string {
  if (!Number.isInteger(panelCount) || panelCount < WEBDEV_SIGNAL_MIN_PANELS || panelCount > WEBDEV_SIGNAL_MAX_PANELS) {
    throw new Error("WebDev Signal templates require 4 to 6 panels");
  }
  return `webdev-signal-change-${panelCount}`;
}

export function webDevSignalSlot(panelIndex: number, field: "locale" | "status" | "project" | "heading" | "body" | "footer"): string {
  if (field === "locale" || field === "status" || field === "project") return `webdev-${field}`;
  const panel = String(panelIndex + 1).padStart(2, "0");
  return `panel-${panel}-${field}`;
}

export function webDevSignalVariant(status: WebDevSignalVisualStatus): "PREVIEW" | "SECURITY" | "BREAKING" | undefined {
  if (status === "preview") return "PREVIEW";
  if (status === "security") return "SECURITY";
  if (status === "breaking" || status === "deprecated") return "BREAKING";
  return undefined;
}

const text = (
  slot: string,
  x: number,
  y: number,
  width: number,
  height: number,
  options: Partial<Extract<CarouselLayerInput, { type: "text" }>> = {}
): CarouselLayerInput => ({
  type: "text",
  slot,
  x,
  y,
  width,
  height,
  colorToken: "foreground",
  fontToken: "body",
  fontWeight: 500,
  minFontSize: 24,
  maxFontSize: 42,
  maxChars: 360,
  maxLines: 6,
  ...options
});

/**
 * One authored composition at three bounded lengths.
 *
 * The geometry reads as a change record: an anchored signal line, an explicit state chip and a
 * numbered proof trail. It contains no fake source code, framework mark, screenshot or image slot.
 * Status colour only changes the accent; the status word travels in the payload and remains the
 * primary meaning. Every accepted character is handed unchanged to the shared measured fitter.
 */
export function webDevSignalTemplate(panelCount: number): CarouselTemplate {
  const templateId = webDevSignalTemplateId(panelCount);
  const fields = ["locale", "status", "project", "heading", "body", "footer"] as const;
  return CarouselTemplateSchema.parse({
    schemaVersion: "carousel-template/1",
    id: templateId,
    name: `WebDev Signal · change record · ${panelCount} panels`,
    version: WEBDEV_SIGNAL_TEMPLATE_VERSION,
    status: "live",
    description: "A source-forward change, impact and action carousel for native Czech and English editions.",
    citedObservationRefs: ["GitHub #436", "GitHub #442"],
    formats: deckFormats,
    canvas: deckCanvas(),
    requiredSlots: [...new Set(Array.from({ length: panelCount }, (_, panelIndex) =>
      fields.map((field) => webDevSignalSlot(panelIndex, field))).flat())],
    slides: Array.from({ length: panelCount }, (_, panelIndex) => ({
      id: `slide-webdev-${String(panelIndex + 1).padStart(2, "0")}`,
      backgroundToken: panelIndex === 0 || panelIndex === panelCount - 1 ? "surface" : "background",
      variants: [
        { id: "PREVIEW", accentToken: "preview" },
        { id: "SECURITY", accentToken: "security" },
        { id: "BREAKING", accentToken: "breaking" }
      ],
      layers: [
        { type: "rule", x: 0.08, y: 0.145, width: 0.84, height: 0.005, colorToken: "accent", thickness: 5 },
        { type: "logo", x: 0.08, y: 0.165, width: 0.46, height: 0.045, colorToken: "foreground", fontToken: "headline" },
        text(webDevSignalSlot(panelIndex, "locale"), 0.76, 0.165, 0.16, 0.035, {
          colorToken: "muted", fontToken: "mono", fontWeight: 700, minFontSize: 18, maxFontSize: 24,
          maxChars: 12, maxLines: 1, align: "end", uppercase: true, tracking: 0.08
        }),
        { type: "shape", x: 0.08, y: 0.235, width: 0.26, height: 0.055, fillToken: "accent", strokeWidth: 0, radius: 0.02 },
        text(webDevSignalSlot(panelIndex, "status"), 0.1, 0.244, 0.22, 0.035, {
          colorToken: "background", fontToken: "mono", fontWeight: 700, minFontSize: 18, maxFontSize: 23,
          maxChars: 20, maxLines: 1, uppercase: true, tracking: 0.05
        }),
        text(webDevSignalSlot(panelIndex, "project"), 0.08, 0.315, 0.84, 0.06, {
          colorToken: "accent", fontToken: "mono", fontWeight: 700, minFontSize: 20, maxFontSize: 30,
          maxChars: 100, maxLines: 2
        }),
        text(webDevSignalSlot(panelIndex, "heading"), 0.08, 0.405, 0.84, 0.15, {
          fontToken: "headline", fontWeight: 800, minFontSize: 38, maxFontSize: 72,
          maxChars: 108, maxLines: 3
        }),
        text(webDevSignalSlot(panelIndex, "body"), 0.08, 0.59, 0.84, 0.16, {
          colorToken: "muted", minFontSize: 25, maxFontSize: 39, maxChars: 360, maxLines: 6
        }),
        { type: "rule", x: 0.08, y: 0.775, width: 0.84, height: 0.003, colorToken: "surface-strong", thickness: 3, dash: true },
        text(webDevSignalSlot(panelIndex, "footer"), 0.08, 0.79, 0.84, 0.035, {
          colorToken: "foreground", fontToken: "mono", fontWeight: 400, minFontSize: 17, maxFontSize: 22,
          maxChars: 160, maxLines: 2
        })
      ]
    }))
  });
}

let templateCache: readonly CarouselTemplate[] | null = null;

export function webDevSignalTemplates(): readonly CarouselTemplate[] {
  templateCache ??= Array.from(
    { length: WEBDEV_SIGNAL_MAX_PANELS - WEBDEV_SIGNAL_MIN_PANELS + 1 },
    (_, index) => webDevSignalTemplate(index + WEBDEV_SIGNAL_MIN_PANELS)
  );
  return templateCache;
}
