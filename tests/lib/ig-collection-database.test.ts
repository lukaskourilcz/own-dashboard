import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/** IG Kolekce runs on the actual knowledge migration plus 20261109120000_ig_collection.sql. */
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
type ImportResult = { added: number; skipped: number; skippedCollection: number; skippedTips: number; addedOlderThanMark: number; previousHighWater: string | null; highWater: string | null; sourceIds: string[] };
const importRows = async (rows: unknown[], provenance = "instagram-export", user = owner) =>
  (await db.query<{ r: ImportResult }>("select marketing_collection_import($1,$2,$3) as r", [user, JSON.stringify(rows), provenance])).rows[0].r;
const row = (shortcode: string, saved_at: string | null, extra: Record<string, unknown> = {}) => ({ shortcode, saved_at, author: "creator", collections: [], ...extra });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  create table public.ai_links(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),record_type text,title text,url text,description text,tip_group text,tip_summary text,source_urls text[] default '{}');
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.notes(id uuid primary key,user_id uuid not null);
  create table public.prompts(id uuid primary key,user_id uuid not null); create table public.tools(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');
  insert into ai_links(user_id,record_type,title,url,tip_summary,source_urls) values
   ('${owner}','idea','Hook tip','https://www.instagram.com/reel/TIP111/?igsh=x','Start with the result.','{}'),
   ('${owner}','link','Saved link','https://example.com/article',null,'{https://instagram.com/creator/p/TIP222/}');`);
  await db.exec(readFileSync("supabase/migrations/20261013193106_marketing_knowledge_import.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261109120000_ig_collection.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });

describe("IG Kolekce import", () => {
  it("backfills the shortcodes the owner's ai_links already hold as done and linked", async () => {
    const rows = await db.query<{ shortcode: string; collection_status: string; ai_link_id: string | null; provenance: string; digest: { summary: string; fromTips: boolean } | null }>("select shortcode,collection_status,ai_link_id,provenance,digest from marketing_knowledge_sources where user_id=$1 order by shortcode", [owner]);
    expect(rows.rows.map((r) => [r.shortcode, r.collection_status, r.provenance])).toEqual([["TIP111", "done", "existing-tip"], ["TIP222", "done", "existing-tip"]]);
    expect(rows.rows[0].digest).toMatchObject({ summary: "Start with the result.", fromTips: true });
    expect(rows.rows[1].digest).toBeNull();
    expect(rows.rows.every((r) => r.ai_link_id)).toBe(true);
  });

  it("skips shortcodes in IG TIPS and Links, also ones added after the migration, without queueing them", async () => {
    await db.query("insert into ai_links(user_id,record_type,title,url,tip_summary) values($1,'idea','Late tip','https://www.instagram.com/p/TIP333/','Late summary.')", [owner]);
    const result = await importRows([row("TIP111", "2026-09-01T10:00:00Z"), row("TIP333", "2026-09-02T10:00:00Z")], "manual");
    expect(result).toMatchObject({ added: 0, skippedTips: 2, skippedCollection: 0 });
    const late = await db.query<{ collection_status: string; digest: { summary: string }; ai_link_id: string }>("select collection_status,digest,ai_link_id from marketing_knowledge_sources where user_id=$1 and shortcode='TIP333'", [owner]);
    expect(late.rows[0]).toMatchObject({ collection_status: "done", digest: { summary: "Late summary." } });
    expect(late.rows[0].ai_link_id).toBeTruthy();
    await db.query("delete from marketing_knowledge_sources where user_id=$1 and shortcode like 'TIP%'", [owner]);
  });

  it("stores new posts as queued and skips known shortcodes", async () => {
    const first = await importRows([row("AAA111", "2026-10-01T10:00:00Z"), row("BBB222", "2026-10-05T10:00:00Z", { collections: ["Tipy"] })]);
    expect(first).toMatchObject({ added: 2, skipped: 0, previousHighWater: null });
    expect(new Date(first.highWater!).toISOString()).toBe("2026-10-05T10:00:00.000Z");
    const stored = await db.query<{ collection_status: string; status: string; saved_at_status: string; canonical_url: string }>("select collection_status,status,saved_at_status,canonical_url from marketing_knowledge_sources where user_id=$1 order by shortcode", [owner]);
    expect(stored.rows.map((r) => r.collection_status)).toEqual(["queued", "queued"]);
    expect(stored.rows[0]).toMatchObject({ status: "partial", saved_at_status: "unverified", canonical_url: "https://www.instagram.com/p/AAA111/" });

    const again = await importRows([row("BBB222", "2026-10-05T10:00:00Z", { collections: ["Reels"] }), row("CCC333", "2026-10-09T10:00:00Z")]);
    expect(again).toMatchObject({ added: 1, skipped: 1, skippedCollection: 1, skippedTips: 0, addedOlderThanMark: 0 });
    expect(new Date(again.highWater!).toISOString()).toBe("2026-10-09T10:00:00.000Z");
    const merged = await db.query<{ collections: string[] }>("select collections from marketing_knowledge_sources where user_id=$1 and shortcode='BBB222'", [owner]);
    expect(merged.rows[0].collections.sort()).toEqual(["Reels", "Tipy"]);
    expect((await db.query<{ n: number }>("select count(*)::int n from marketing_knowledge_sources where user_id=$1", [owner])).rows[0].n).toBe(3);
  });

  it("keeps the high-water mark at the newest exported save and counts unknown older posts", async () => {
    const older = await importRows([row("DDD444", "2026-09-01T10:00:00Z")]);
    expect(older).toMatchObject({ added: 1, addedOlderThanMark: 1 });
    expect(new Date(older.highWater!).toISOString()).toBe("2026-10-09T10:00:00.000Z");
    // A shared or pasted post never moves the export mark.
    const manual = await importRows([row("EEE555", "2026-11-09T10:00:00Z")], "manual");
    expect(manual.added).toBe(1);
    expect(new Date(manual.highWater!).toISOString()).toBe("2026-10-09T10:00:00.000Z");
  });

  it("deduplicates per owner, not across owners", async () => {
    const foreign = await importRows([row("AAA111", "2026-10-01T10:00:00Z")], "instagram-export", other);
    expect(foreign).toMatchObject({ added: 1, skipped: 0 });
  });

  it("rejects malformed shortcodes and oversized batches", async () => {
    await expect(importRows([row("bad/code", null)])).rejects.toThrow("invalid collection row");
    await expect(importRows(Array.from({ length: 501 }, (_, i) => row(`X${i}`, null)))).rejects.toThrow("invalid collection import");
  });
});

describe("IG Kolekce processing state", () => {
  it("claims a queued post once and records the run", async () => {
    const { rows } = await db.query<{ id: string }>("select id from marketing_knowledge_sources where user_id=$1 and shortcode='AAA111'", [owner]);
    const claim = (user = owner) => db.query<{ c: { collection_status: string } | null }>("select marketing_collection_claim($1,$2) as c", [user, rows[0].id]);
    expect((await claim(other)).rows[0].c).toBeNull();
    expect((await claim()).rows[0].c?.collection_status).toBe("scraping");
    expect((await claim()).rows[0].c).toBeNull();
    const settings = await db.query<{ last_run_at: Date | null }>("select last_run_at from marketing_collection_settings where user_id=$1", [owner]);
    expect(settings.rows[0].last_run_at).not.toBeNull();
  });

  it("finishes with a digest, joins procedures as ideas and allows a requeue", async () => {
    const { rows } = await db.query<{ id: string; content: unknown }>("select id,content from marketing_knowledge_sources where user_id=$1 and shortcode='AAA111'", [owner]);
    const id = rows[0].id;
    const source = { shortcode: "AAA111", canonical_url: "https://www.instagram.com/p/AAA111/", saved_at: "2026-10-01T10:00:00.000Z", saved_at_status: "unverified", published_at: null,
      imported_at: "2026-11-09T10:00:00.000Z", cutoff: "2026-11-09T10:00:00.000Z", provenance: "instagram-export", status: "review",
      content: { caption: "Hook in one line.", captionProvider: "apify/instagram-reel-scraper", transcript: { status: "not-requested", provider: null, costUsd: null, segments: [], reason: "not-requested" }, ocr: { status: "not-requested", provider: null, costUsd: null, segments: [], reason: "not-requested" } },
      analysis_key: null, budget_usd: 0.05, run_id: null, dataset_id: null, analysis: null, analysis_request: null };
    const item = { title: "One-line hook", summary: "Open with one line.", steps: ["Write the hook in one line."], category: "marketing", tipGroup: null,
      tags: { goal: [], stage: [], format: [], tool: [], brand: [], effort: "unknown" }, evidence: [{ shortcode: "AAA111", channel: "caption", quote: "Hook in one line.", startSeconds: null, endSeconds: null }],
      missingParts: [], contraryClaims: [], aiLinkId: null, procedureHash: "a".repeat(64), sourceShortcodes: ["AAA111"], references: { projectIds: [], noteIds: [], promptIds: [], toolIds: [] }, evidenceStatus: "needs-review" };
    const digest = { summary: "Open with one line.", tips: ["Hook in one line"], tags: ["hooks"], project: "devShark" };
    await db.query("select marketing_collection_finish($1,$2,'done',null,$3,$4,$5,'collection:test')", [owner, id, JSON.stringify(digest), JSON.stringify(source), JSON.stringify([item])]);
    const done = await db.query<{ collection_status: string; digest: { project: string }; status: string }>("select collection_status,digest,status from marketing_knowledge_sources where id=$1", [id]);
    expect(done.rows[0]).toMatchObject({ collection_status: "done", status: "review", digest: { project: "devShark" } });
    expect((await db.query<{ n: number }>("select count(*)::int n from ai_links where user_id=$1 and title='One-line hook'", [owner])).rows[0].n).toBe(1);
    // A finished post cannot be finished twice without a new claim.
    await expect(db.query("select marketing_collection_finish($1,$2,'failed','collection-test',null,null,null,'x')", [owner, id])).rejects.toThrow("not running");
    expect((await db.query<{ n: number }>("select marketing_collection_requeue($1,$2) as n", [other, [id]])).rows[0].n).toBe(0);
    expect((await db.query<{ n: number }>("select marketing_collection_requeue($1,$2) as n", [owner, [id]])).rows[0].n).toBe(1);
    expect((await db.query<{ s: string }>("select collection_status s from marketing_knowledge_sources where id=$1", [id])).rows[0].s).toBe("queued");
  });

  it("keeps the token hash out of the owner's client grant", async () => {
    const grants = await db.query<{ column_name: string }>("select column_name from information_schema.column_privileges where table_name='marketing_collection_settings' and grantee='authenticated'");
    expect(grants.rows.map((g) => g.column_name)).not.toContain("share_token_hash");
    expect(grants.rows.map((g) => g.column_name)).toContain("high_water_saved_at");
  });
});
