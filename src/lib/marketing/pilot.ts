import "server-only";
import { z } from "zod";
import { previewPilotRetired } from "./preview-pilot";

export const MARKETING_PILOT_MAX_JOBS = 3;
export const MARKETING_PILOT_JOB_RESERVATION_USD = 0.25;
export const MARKETING_PILOT_MAX_COST_USD = 0.75;
const names = ["MARKETING_PILOT_OWNER_ID", "MARKETING_PILOT_STARTS_AT", "MARKETING_PILOT_EXPIRES_AT"] as const;
const schema = z.strictObject({ ownerId: z.uuid(), startsAt: z.iso.datetime(), expiresAt: z.iso.datetime() });
export type MarketingPilot = z.infer<typeof schema>;
export class MarketingPilotError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "MarketingPilotError"; }
}
/**
 * No pilot settings preserves normal admission. A partial tuple never disables the guard in Preview.
 * Outside Preview the retired tuple is ignored (#113): no pilot authority, no admission failure.
 */
export function marketingPilotConfiguration(ownerId: string, env: Record<string, string | undefined> = process.env, now = new Date()): MarketingPilot | null {
  if (names.every((name) => env[name] === undefined) || previewPilotRetired("generation-pilot", env)) return null;
  const instant = now.getTime();
  if (!Number.isFinite(instant)) throw new MarketingPilotError("pilot-clock-invalid");
  const parsed = schema.safeParse({ ownerId: env.MARKETING_PILOT_OWNER_ID, startsAt: env.MARKETING_PILOT_STARTS_AT, expiresAt: env.MARKETING_PILOT_EXPIRES_AT });
  if (!parsed.success) throw new MarketingPilotError("pilot-configuration-invalid");
  const pilot = parsed.data;
  const start = Date.parse(pilot.startsAt), end = Date.parse(pilot.expiresAt);
  if (pilot.ownerId !== ownerId) throw new MarketingPilotError("pilot-owner-mismatch");
  if (end <= start || end - start > 48 * 60 * 60 * 1000) throw new MarketingPilotError("pilot-configuration-invalid");
  if (instant < start || instant >= end) throw new MarketingPilotError("pilot-outside-window");
  return pilot;
}
