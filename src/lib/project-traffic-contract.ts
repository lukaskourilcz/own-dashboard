import { z } from "zod";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const TrafficTotalsSchema = z.object({ pageviews: count, visitors: count }).strict().refine(value => value.visitors <= value.pageviews);
const day = z.iso.date();
const window = z.object({ since: day, until: day }).strict().refine(value => Date.parse(value.until) - Date.parse(value.since) === 29 * 86_400_000);
const traffic = z.object({
  kind: z.literal("ok"), projectId: z.string().min(1).max(128).regex(/^[a-z0-9_-]+$/i),
  lifetime: TrafficTotalsSchema, last30: TrafficTotalsSchema,
  daily: z.array(z.object({ date: day, pageviews: count, visitors: count }).strict().refine(value => value.visitors <= value.pageviews)).max(30),
  window, checkedAt: z.iso.datetime({ offset: true }),
}).strict().superRefine((value, ctx) => {
  let previous = "", pageviews = 0, visitors = 0;
  for (const row of value.daily) {
    if (row.date < value.window.since || row.date > value.window.until || row.date <= previous) ctx.addIssue({ code: "custom", message: "Invalid traffic window" });
    previous = row.date; pageviews += row.pageviews; visitors += row.visitors;
  }
  if (!Number.isSafeInteger(pageviews) || !Number.isSafeInteger(visitors) || pageviews !== value.last30.pageviews
    || value.last30.visitors > visitors || value.daily.some(row => row.visitors > value.last30.visitors) || value.lifetime.pageviews < value.last30.pageviews || value.lifetime.visitors < value.last30.visitors) ctx.addIssue({ code: "custom", message: "Incomplete traffic totals" });
  if (new Date(value.checkedAt).toISOString().slice(0, 10) !== value.window.until) ctx.addIssue({ code: "custom", message: "Invalid traffic clock" });
});
export const ProjectTrafficSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("unconfigured") }).strict(), z.object({ kind: z.literal("not-found") }).strict(),
  z.object({ kind: z.literal("error") }).strict(), traffic,
]);
export type ProjectTraffic = z.infer<typeof ProjectTrafficSchema>;
export const ProjectTrafficResponseSchema = z.object({ ownerId: z.uuid(), traffic: ProjectTrafficSchema }).strict();
