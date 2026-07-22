import "server-only";
import { timingSafeEqual } from "node:crypto";

export function authorizeAgentRunner(request: Request): { ownerId: string } | null {
  const expected = process.env.AGENT_RUNNER_TOKEN;
  const ownerId = process.env.DASHBOARD_OWNER_ID;
  const provided = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!expected || !ownerId || !provided) return null;
  const expectedBytes = Buffer.from(expected);
  const providedBytes = Buffer.from(provided);
  if (expectedBytes.length !== providedBytes.length) return null;
  return timingSafeEqual(expectedBytes, providedBytes) ? { ownerId } : null;
}
