import { type CarouselTemplate } from "./schema.js";
export declare const WEBDEV_SIGNAL_MIN_PANELS = 4;
export declare const WEBDEV_SIGNAL_MAX_PANELS = 6;
export declare const WEBDEV_SIGNAL_TEMPLATE_VERSION = "1.0.0";
export type WebDevSignalVisualStatus = "stable" | "preview" | "security" | "breaking" | "deprecated";
export declare function webDevSignalTemplateId(panelCount: number): string;
export declare function webDevSignalSlot(panelIndex: number, field: "locale" | "status" | "project" | "heading" | "body" | "footer"): string;
export declare function webDevSignalVariant(status: WebDevSignalVisualStatus): "PREVIEW" | "SECURITY" | "BREAKING" | undefined;
/**
 * One authored composition at three bounded lengths.
 *
 * The geometry reads as a change record: an anchored signal line, an explicit state chip and a
 * numbered proof trail. It contains no fake source code, framework mark, screenshot or image slot.
 * Status colour only changes the accent; the status word travels in the payload and remains the
 * primary meaning. Every accepted character is handed unchanged to the shared measured fitter.
 */
export declare function webDevSignalTemplate(panelCount: number): CarouselTemplate;
export declare function webDevSignalTemplates(): readonly CarouselTemplate[];
//# sourceMappingURL=families-webdev.d.ts.map