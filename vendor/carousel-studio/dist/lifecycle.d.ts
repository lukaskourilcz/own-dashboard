import { z } from "zod";
import { type CarouselTemplate } from "./schema.js";
import { type TemplateCheck } from "./validation.js";
export declare const TemplateLifecycleOverrideSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<"carousel-template-overrides/1">;
    overrides: z.ZodArray<z.ZodObject<{
        templateId: z.ZodString;
        version: z.ZodString;
        status: z.ZodEnum<{
            draft: "draft";
            live: "live";
            deprecated: "deprecated";
        }>;
        reason: z.ZodString;
        changedAt: z.ZodISODateTime;
        changedBy: z.ZodEnum<{
            owner: "owner";
            EASEL: "EASEL";
        }>;
    }, z.core.$strip>>;
    updatedAt: z.ZodISODateTime;
}, z.core.$strip>;
export declare function resolveLifecycleStatus(input: {
    template: CarouselTemplate;
    checks: readonly TemplateCheck[];
    ownerOverride?: "draft" | "live" | "deprecated";
}): CarouselTemplate["status"];
export declare function deprecateTemplate(template: CarouselTemplate): CarouselTemplate;
//# sourceMappingURL=lifecycle.d.ts.map