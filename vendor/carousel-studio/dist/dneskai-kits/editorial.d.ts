import type { CarouselTemplate } from "../schema.js";
import { type DneskaiFlow } from "../dneskai-layout.js";
/** Every DNESKAi photo-kit template, by id. */
export declare const DNESKAI_PHOTO_TEMPLATES: ReadonlyMap<string, CarouselTemplate>;
/** The sources template that carries exactly this many thumbnails. */
export declare function dneskaiSourcesTemplate(thumbnails: number): CarouselTemplate;
export declare const DNESKAI_EDITORIAL_FLOWS: Readonly<Record<string, DneskaiFlow>>;
export declare const EDITORIAL_KIT: import("./kit.js").DneskaiKit;
//# sourceMappingURL=editorial.d.ts.map