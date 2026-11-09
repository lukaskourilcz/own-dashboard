import { NextResponse } from "next/server";
import { z } from "zod";
import { bearerToken } from "@/lib/cron-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { rateLimit } from "@/lib/rate-limit";
import { boundedRequestText } from "@/lib/marketing/http";
import { shortcodesFromText } from "@/lib/marketing/ig-collection";
import { SHARE_TOKEN_PATTERN, hashShareToken } from "@/lib/marketing/ig-collection-token";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
const BodySchema = z.object({ url: z.string().max(4000).optional(), text: z.string().max(4000).optional() });

/**
 * POST /api/marketing/knowledge/share — the iOS Shortcut from the Instagram share sheet (docs/ig-kolekce.md).
 * `Authorization: Bearer <owner share token>`; the database holds only the token's SHA-256. Body: JSON `{url}` or
 * `{text}`, or the shared text as text/plain. Stores one public post/Reel URL in IG Kolekce as queued, or reports it
 * as already known (in IG Kolekce or in IG TIPS / Links). It never starts a scrape or a model call.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  const byIp = await rateLimit(`share:${ip}`, { key: "collection-share-ip", limit: 30, windowSec: 60 });
  if (!byIp.ok) return fail(429, "rate-limited");
  const token = bearerToken(request.headers.get("authorization"));
  if (!token || !SHARE_TOKEN_PATTERN.test(token)) return fail(401, "unauthorized");
  const db = createAdminClient();
  const { data: settings, error } = await db.from("marketing_collection_settings").select("user_id").eq("share_token_hash", hashShareToken(token)).maybeSingle();
  if (error) return fail(503, "share-unavailable");
  if (!settings) return fail(401, "unauthorized");
  const owner = String(settings.user_id);
  const byOwner = await rateLimit(owner, { key: "collection-share", limit: 60, windowSec: 3600 });
  if (!byOwner.ok) return fail(429, "rate-limited");

  let text: string;
  try {
    const raw = await boundedRequestText(request, 8000);
    if ((request.headers.get("content-type") ?? "").includes("application/json")) {
      const body = BodySchema.parse(JSON.parse(raw));
      text = [body.url, body.text].filter(Boolean).join(" ");
    } else text = raw;
  } catch { return fail(400, "share-request-invalid"); }
  const shortcode = shortcodesFromText(text).shortcodes[0];
  if (!shortcode) return fail(400, "share-no-post-url");
  const { data, error: importError } = await db.rpc("marketing_collection_import", { p_owner: owner,
    p_rows: [{ shortcode, saved_at: new Date().toISOString(), author: null, collections: [] }], p_provenance: "manual" });
  if (importError || !data) return fail(503, "share-import-failed");
  const status = data.added ? "added" : data.skippedTips ? "already-in-tips" : "already-in-collection";
  return NextResponse.json({ status, shortcode }, { headers });
}
