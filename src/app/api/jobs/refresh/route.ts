import { NextResponse } from "next/server";
import { z } from "zod";
import { awaitWithSignal } from "@/lib/abortable";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { runJobScrape } from "@/lib/jobs/scrape";

/** Manual Career refresh only. No schedule invokes this route. Public-board
 * fan-out keeps the existing two-attempts-per-ten-minute owner limit. */
export const maxDuration = 60;
const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number) => NextResponse.json({ error: status === 401 ? "unauthorized" : status === 409 ? "owner-changed" : status === 400 ? "invalid-request" : "jobs-refresh-unavailable" }, { status, headers });
const PreferenceSchema = z.strictObject({ show_czech_career: z.boolean() });

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  // Legacy callers omit this header. Captured callers cannot refresh as a later owner.
  const expectedOwner = request.headers.get("x-own-dashboard-owner");
  if (expectedOwner !== null && !z.uuid().safeParse(expectedOwner).success) return fail(400);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal, AbortSignal.timeout(55_000)]);
  const phase = (ms: number) => AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  try {
    signal.throwIfAborted();
    const authSignal = phase(8_000);
    const supabase = await awaitWithSignal(createClient(signal), authSignal);
    const auth = await awaitWithSignal(supabase.auth.getUser(), authSignal);
    authSignal.throwIfAborted();
    if (auth.error) return fail([400, 401, 403].includes(auth.error.status ?? 0) ? 401 : 503);
    const user = auth.data.user;
    if (!user || !z.uuid().safeParse(user.id).success) return fail(401);
    if (expectedOwner !== null && expectedOwner !== user.id) return fail(409);

    const limitSignal = phase(5_000);
    const rl = await awaitWithSignal(rateLimit(user.id, { key: "jobs-refresh", limit: 2, windowSec: 600 }), limitSignal);
    limitSignal.throwIfAborted();
    if (!rl.ok) {
      if (!Number.isSafeInteger(rl.retryAfter) || rl.retryAfter < 1 || rl.retryAfter > 600) return fail(503);
      return NextResponse.json({ error: "Too many refreshes.", retryAfter: rl.retryAfter }, { status: 429, headers: { ...headers, "Retry-After": String(rl.retryAfter) } });
    }

    const readSignal = phase(5_000);
    const preferences = await awaitWithSignal(supabase.from("user_preferences").select("show_czech_career").eq("user_id", user.id).retry(false).abortSignal(readSignal).maybeSingle(), readSignal);
    readSignal.throwIfAborted();
    if (preferences.error) return fail(503);
    // Only an absent row uses the established default; a failed/malformed read is unavailable.
    const parsed = preferences.data === null ? null : PreferenceSchema.safeParse(preferences.data);
    if (parsed !== null && !parsed.success) return fail(503);
    const includeCzech = parsed?.data?.show_czech_career === true;
    const scrapeSignal = phase(45_000);
    scrapeSignal.throwIfAborted();
    const admin = createAdminClient(scrapeSignal);
    const summary = await awaitWithSignal(runJobScrape(admin, { includeCzech }), scrapeSignal);
    scrapeSignal.throwIfAborted();
    // Tombstones stay owner-scoped; this route never deletes a shared listing itself.
    return NextResponse.json(expectedOwner === null ? summary : { ...summary, ownerId: user.id }, { status: summary.ok ? 200 : 500, headers });
  } catch {
    return fail(503);
  } finally { lifetime.abort(); }
}
