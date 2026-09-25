import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/** The token in an `Authorization: Bearer <token>` header, or null. */
export function bearerToken(header: string | null): string | null {
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match ? match[1] : null;
}

/**
 * Whether `header` carries `Bearer <secret>`, compared in constant time.
 * False whenever the secret is unset or blank: an endpoint guarded by a secret
 * nobody configured refuses every caller instead of admitting every caller.
 */
export function bearerMatches(
  header: string | null,
  secret: string | undefined,
): boolean {
  if (!secret?.trim()) return false;
  const token = bearerToken(header);
  if (token === null) return false;
  // Hashing first gives both sides the same length, which timingSafeEqual
  // requires, without revealing the secret's length through an early return.
  const given = createHash("sha256").update(token).digest();
  const expected = createHash("sha256").update(secret).digest();
  return timingSafeEqual(given, expected);
}

/**
 * The gate every `/api/cron/*` route calls first. Vercel Cron sends
 * `Authorization: Bearer ${CRON_SECRET}` when the project defines CRON_SECRET.
 * Fails closed: without a configured secret every call gets 403, so a
 * deployment that forgot the secret runs no job for an anonymous caller.
 * Returns the response to send, or null when the caller may proceed.
 */
export function rejectUnlessCron(request: Request): NextResponse | null {
  if (bearerMatches(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return null;
  }
  return NextResponse.json({ error: "Forbidden." }, { status: 403 });
}
