import { type BrandTokens, type CarouselCanvas, type CarouselFormat, type CarouselTemplate } from "./schema.js";
export interface TemplateCheck {
    id: "schema" | "canvas" | "platform-limits" | "safe-area" | "contrast" | "apca" | "brand-tokens" | "overflow" | "script" | "originality";
    status: "pass" | "fail";
    detail: string;
}
/**
 * The canvases a template says it was composed for: its master, then whatever it derives.
 *
 * In the order the studio renders them rather than the order the record lists them, so two
 * templates that declare the same set answer identically.
 */
export declare function declaredCanvases(template: CarouselTemplate): CarouselCanvas[];
export declare function contrastRatio(foreground: string, background: string): number;
/**
 * Whether a template's text and logos sit inside a canvas's safe area.
 *
 * The geometry half of `safeAreaCheck`, without the brand or the check wrapper, so the library can
 * answer "is this template composed for that canvas" without pretending to validate it.
 */
export declare function fitsSafeArea(template: CarouselTemplate, format: CarouselFormat): boolean;
export declare function validateTemplateForBrand(template: CarouselTemplate, brand: BrandTokens, format: CarouselFormat): TemplateCheck[];
export declare function mayGoLive(checks: readonly TemplateCheck[]): boolean;
//# sourceMappingURL=validation.d.ts.map