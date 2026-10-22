import type { CarouselTemplate } from '../schema.js';
import type { DneskaiFlow, DneskaiLayoutMetrics } from '../dneskai-layout.js';
import { type DneskaiKitId, type DneskaiSlideType, type DneskaiTemplateRole, type DneskaiTextField, type DneskaiVariant } from './contract.js';
export interface DneskaiFieldFace {
    family: string;
    weight: number;
    uppercase: boolean;
}
export interface DneskaiKitTemplate {
    role: DneskaiTemplateRole;
    thumbnails?: number;
    template: CarouselTemplate;
    flow: DneskaiFlow;
}
export interface DneskaiKit {
    readonly id: DneskaiKitId;
    readonly label: string;
    readonly purpose: string;
    readonly look: string;
    readonly templates: ReadonlyMap<string, CarouselTemplate>;
    readonly roles: ReadonlyMap<string, DneskaiTemplateRole>;
    readonly flows: ReadonlyMap<string, DneskaiFlow>;
    readonly metrics: DneskaiLayoutMetrics;
    resolve(type: DneskaiSlideType, variant: DneskaiVariant | undefined, imageSlots: readonly string[]): CarouselTemplate;
    readonly fieldFaces: Readonly<Record<DneskaiTextField, DneskaiFieldFace>>;
    readonly placedFields: Readonly<Record<DneskaiSlideType, readonly DneskaiTextField[]>>;
}
/** Importing a kit verifies structure only. Font/manifest reads wait for the first fieldFaces access. */
export declare function defineDneskaiKit(input: {
    id: DneskaiKitId;
    label: string;
    purpose: string;
    look: string;
    metrics: DneskaiLayoutMetrics;
    templates: readonly DneskaiKitTemplate[];
}): DneskaiKit;
//# sourceMappingURL=kit.d.ts.map