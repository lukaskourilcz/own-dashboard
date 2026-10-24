import { z } from "zod";
export const cronRunStatus = z.enum(["success", "failure", "running"]);
export const cronRunSource = z.enum(["app", "vercel", "github_actions", "external"]);
export const externalCronRun = z.strictObject({
  name: z.string().trim().min(1).max(200), status: cronRunStatus,
  source: cronRunSource.default("github_actions"), endpoint: z.string().max(400).default(""),
  detail: z.string().max(1000).default(""), cron_id: z.uuid().nullable().default(null),
});
