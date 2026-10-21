import { type CarouselTemplate } from "./schema.js";
/** The most source lines and thumbnails a sources slide carries. */
export declare const DNESKAI_MAX_SOURCES = 4;
export declare const DNESKAI_MAX_THUMBNAILS = 6;
/** The slot of the Nth source line, one-based. */
export declare const dneskaiSourceSlot: (index: number) => string;
/** Every DNESKAi photo-kit template, by id. */
export declare const DNESKAI_PHOTO_TEMPLATES: ReadonlyMap<string, CarouselTemplate>;
/** The sources template that carries exactly this many thumbnails. */
export declare function dneskaiSourcesTemplate(thumbnails: number): CarouselTemplate;
//# sourceMappingURL=dneskai-photo.d.ts.map