import { after, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { readKnowledgeBody } from "@/lib/marketing/knowledge-body";
import { COLLECTION_IMPORT_CHUNK, COLLECTION_PROCESS_LIMIT, CollectionImportRowSchema, collectionPostFromRow, shortcodesFromText, type CollectionOverview } from "@/lib/marketing/ig-collection";
import { processCollectionQueue } from "@/lib/marketing/ig-collection-runner";
import { hashShareToken, newShareToken } from "@/lib/marketing/ig-collection-token";

export const runtime = "nodejs";
/** A Process click runs its posts in `after()` inside this function's 300 s. */
export const maxDuration = 300;

const headers = { "Cache-Control": "private, no-store" };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers });
const COLUMNS = "id,shortcode,canonical_url,author,saved_at,published_at,collections,collection_status,collection_error,media,digest,processed_at,ai_link_id,provenance";

const ActionSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("import"), rows: z.array(CollectionImportRowSchema).min(1).max(COLLECTION_IMPORT_CHUNK) }),
  z.strictObject({ action: z.literal("add-urls"), text: z.string().min(1).max(200_000) }),
  // The owner's consent click: every paid run starts here and nowhere else.
  z.strictObject({ action: z.literal("process"), consent: z.literal(true), sourceIds: z.array(z.uuid()).min(1).max(COLLECTION_PROCESS_LIMIT).optional() }),
  z.strictObject({ action: z.literal("reprocess"), consent: z.literal(true), sourceId: z.uuid() }),
  z.strictObject({ action: z.literal("rotate-token") }),
  z.strictObject({ action: z.literal("revoke-token") }),
]);

/** GET /api/marketing/collection: the owner's saved posts (newest 1000) and the header line. */
export async function GET() {
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return fail(401, "unauthorized");
  const base = () => db.from("marketing_knowledge_sources").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  const [posts, settings, total, inTips, queued] = await Promise.all([
    db.from("marketing_knowledge_sources").select(COLUMNS).eq("user_id", user.id).order("saved_at", { ascending: false, nullsFirst: false }).limit(1000),
    db.from("marketing_collection_settings").select("share_token_created_at,high_water_saved_at,last_import_at,last_run_at").eq("user_id", user.id).maybeSingle(),
    base(), base().not("ai_link_id", "is", null), base().eq("collection_status", "queued"),
  ]);
  if (posts.error || settings.error || total.error || inTips.error || queued.error) return fail(503, "collection-unavailable");
  const s = settings.data;
  const overview: CollectionOverview = { highWater: s?.high_water_saved_at ?? null, count: total.count ?? 0, inTips: inTips.count ?? 0, queued: queued.count ?? 0,
    lastRun: s?.last_run_at ?? null, lastImport: s?.last_import_at ?? null, hasShareToken: !!s?.share_token_created_at, shareTokenCreatedAt: s?.share_token_created_at ?? null };
  return NextResponse.json({ overview, posts: (posts.data ?? []).map((row) => collectionPostFromRow(row as Record<string, unknown>)) }, { headers });
}

/** POST /api/marketing/collection: import, add URLs, Process / Re-process (consent), share-token rotation. */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient(); const { data: { user } } = await db.auth.getUser();
  if (!user) return fail(401, "unauthorized");
  const limited = await rateLimit(user.id, { key: "marketing-collection", limit: 40, windowSec: 60 });
  if (!limited.ok) return fail(429, "collection-rate-limited");
  let input: z.infer<typeof ActionSchema>;
  try { input = ActionSchema.parse(JSON.parse(await readKnowledgeBody(request))); }
  catch (error) { return error instanceof Error && error.message === "capture-too-large" ? fail(413, "collection-too-large") : fail(400, "collection-request-invalid"); }
  const admin = createAdminClient();
  if (input.action === "import" || input.action === "add-urls") {
    let rows = input.action === "import" ? input.rows : [];
    let rejected = 0;
    if (input.action === "add-urls") {
      try {
        const found = shortcodesFromText(input.text); rejected = found.rejected;
        const savedAt = new Date().toISOString();
        rows = found.shortcodes.map((shortcode) => ({ shortcode, saved_at: savedAt, author: null, collections: [] }));
      } catch { return fail(400, "collection-too-many-urls"); }
      if (!rows.length) return fail(400, "collection-no-post-urls");
    }
    const { data, error } = await admin.rpc("marketing_collection_import", { p_owner: user.id, p_rows: rows, p_provenance: input.action === "import" ? "instagram-export" : "manual" });
    if (error) return fail(503, "collection-import-failed");
    return NextResponse.json({ ...data, rejected }, { headers });
  }
  if (input.action === "rotate-token" || input.action === "revoke-token") {
    const token = input.action === "rotate-token" ? newShareToken() : null;
    const { error } = await admin.from("marketing_collection_settings").upsert({ user_id: user.id, share_token_hash: token ? hashShareToken(token) : null,
      share_token_created_at: token ? new Date().toISOString() : null, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
    if (error) return fail(503, "collection-token-failed");
    // Shown once; only the hash is stored.
    return NextResponse.json({ token }, { headers });
  }
  let sourceIds = input.action === "process" ? input.sourceIds : [input.sourceId];
  if (input.action === "reprocess") {
    const { data, error } = await admin.rpc("marketing_collection_requeue", { p_owner: user.id, p_sources: sourceIds });
    if (error) return fail(503, "collection-requeue-failed");
    if (!data) {
      const { data: row } = await db.from("marketing_knowledge_sources").select("collection_status").eq("user_id", user.id).eq("id", input.sourceId).maybeSingle();
      if (!row) return fail(404, "collection-post-unavailable");
      if (row.collection_status !== "queued") return fail(409, "collection-post-running");
    }
  }
  if (!sourceIds) {
    const { data, error } = await db.from("marketing_knowledge_sources").select("id").eq("user_id", user.id).eq("collection_status", "queued").order("saved_at", { ascending: false, nullsFirst: false }).limit(COLLECTION_PROCESS_LIMIT);
    if (error) return fail(503, "collection-unavailable");
    sourceIds = (data ?? []).map((row) => String(row.id));
  }
  if (!sourceIds.length) return NextResponse.json({ accepted: 0 }, { headers });
  const owner = user.id; const ids = sourceIds; const until = Date.now() + 280_000;
  after(async () => {
    try {
      const run = await processCollectionQueue(owner, { consent: true, sourceIds: ids }, {}, until);
      console.info(JSON.stringify({ event: "ig-collection-run", posts: run.results.length, statuses: run.results.map((r) => r.reason ?? r.status), costUsd: run.costUsd }));
    } catch (error) { console.warn(JSON.stringify({ event: "ig-collection-run-failed", code: error instanceof Error ? error.message.slice(0, 80) : "unknown" })); }
  });
  return NextResponse.json({ accepted: ids.length }, { status: 202, headers });
}
