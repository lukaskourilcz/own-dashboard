import { z } from "zod";
import { TemplateStatusSchema, type CarouselTemplate } from "./schema.js";
import { mayGoLive, type TemplateCheck } from "./validation.js";

export const TemplateLifecycleOverrideSchema = z.object({
  schemaVersion: z.literal("carousel-template-overrides/1"),
  overrides: z.array(z.object({
    templateId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    status: TemplateStatusSchema,
    reason: z.string().trim().min(1).max(400),
    changedAt: z.iso.datetime({ offset: true }),
    changedBy: z.enum(["EASEL", "owner"])
  })),
  updatedAt: z.iso.datetime({ offset: true })
});

export function resolveLifecycleStatus(input: {
  template: CarouselTemplate;
  checks: readonly TemplateCheck[];
  ownerOverride?: "draft" | "live" | "deprecated";
}): CarouselTemplate["status"] {
  if (input.ownerOverride === "deprecated") return "deprecated";
  if (input.ownerOverride === "draft") return "draft";
  if (input.ownerOverride === "live" && mayGoLive(input.checks)) return "live";
  if (input.template.status === "deprecated") return "deprecated";
  return mayGoLive(input.checks) ? "live" : "draft";
}

export function deprecateTemplate(template: CarouselTemplate): CarouselTemplate {
  return { ...template, status: "deprecated" };
}
