import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyReferences, emptyTags, planKnowledgeCapture, procedureHash, type KnowledgeItem } from "@/lib/marketing/knowledge";
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111"; const other = "22222222-2222-4222-8222-222222222222";
const legacy = "33333333-3333-4333-8333-333333333333"; const foreign = "44444444-4444-4444-8444-444444444444";
const source = (shortcode = "ABC123") => planKnowledgeCapture({ cutoff: "2026-10-13T00:00:00Z", input: [{ url: `https://instagram.com/reel/${shortcode}/`, saved_at: "2026-10-01T00:00:00Z", caption: "Choose one goal." }] }, new Date("2026-10-13T12:00:00Z")).sources[0];
const item = (shortcode = "ABC123", patch: Partial<KnowledgeItem> = {}): KnowledgeItem => {
 const p = { title: "Choose a goal", summary: "Choose one goal.", steps: ["Choose one goal."], category: "marketing" as const, tipGroup: "content" as const, tags: emptyTags(), evidence: [{ shortcode, channel: "caption" as const, quote: "Choose one goal.", startSeconds: null, endSeconds: null }], missingParts: [], contraryClaims: [] };
 return { ...p, aiLinkId: null, procedureHash: procedureHash(p), sourceShortcodes: [shortcode], references: emptyReferences(), evidenceStatus: "needs-review", ...patch };
};
const save = (sources: unknown[], items: unknown[], event: string, user = owner) => db.query<{ result: { sourceIds: string[]; knowledgeIds: string[]; createdItems: number; duplicate: boolean } }>("select marketing_import_knowledge($1,$2,$3,$4) as result", [user, JSON.stringify(sources), JSON.stringify(items), event]);
beforeAll(async () => {
 db = new PGlite(); await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
 create table public.ai_links(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),record_type text,title text,url text,description text,tip_group text,tip_summary text,source_urls text[] default '{}');
 create table public.projects(id uuid primary key,user_id uuid not null); create table public.notes(id uuid primary key,user_id uuid not null);
 create table public.prompts(id uuid primary key,user_id uuid not null); create table public.tools(id uuid primary key,user_id uuid not null);
 insert into auth.users values('${owner}'),('${other}');
 insert into ai_links(id,user_id,record_type,title,url,description) values('${legacy}','${owner}','idea','Canonical legacy tip','https://instagram.com/p/LEGACY/','Original notes'),('${foreign}','${other}','idea','Other owner tip','https://instagram.com/p/OTHER/','Private');
 insert into projects values('${foreign}','${other}'); insert into notes values('${foreign}','${other}'); insert into prompts values('${foreign}','${other}'); insert into tools values('${foreign}','${other}');`);
 await db.exec(readFileSync("supabase/migrations/20261013193106_marketing_knowledge_import.sql", "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });
describe("Atomic owner knowledge import", () => {
 it("imports several procedures atomically and suppresses duplicate events even when imported_at changes", async () => {
  const first = await save([source()], [item(), item("ABC123", { title: "Second procedure", procedureHash: "b".repeat(64) })], "first");
  expect(first.rows[0].result.createdItems).toBe(2);
  const duplicate = await save([{ ...source(), imported_at: "2026-10-14T12:00:00Z" }], [item(), item("ABC123", { title: "Second procedure", procedureHash: "b".repeat(64) })], "first");
  expect(duplicate.rows[0].result.duplicate).toBe(true);
  expect((await db.query<{ count: number }>("select count(*)::int count from ai_links where user_id=$1", [owner])).rows[0].count).toBe(3);
  expect((await db.query<{ imported_at: Date }>("select imported_at from marketing_knowledge_sources where user_id=$1 and shortcode='ABC123'", [owner])).rows[0].imported_at.toISOString()).toContain("2026-10-13");
 });
 it("joins identical advice from another source without another canonical tip", async () => {
  const result = await save([source("DEF456")], [item("DEF456")], "second-source"); expect(result.rows[0].result.createdItems).toBe(0);
  const stored = await db.query<{ source_ids: string[]; evidence: unknown[] }>("select source_ids,evidence from marketing_knowledge_items where user_id=$1 and procedure_hash=$2", [owner, item().procedureHash]);
  expect(stored.rows[0].source_ids).toHaveLength(2); expect(stored.rows[0].evidence).toHaveLength(2);
 });
 it("preserves existing tip IDs and authored notes while normalizing sidecars", async () => {
  const result = await save([], [item("ABC123", { aiLinkId: legacy, procedureHash: "c".repeat(64), sourceShortcodes: [], evidence: [{ shortcode: "ABC123", channel: "legacy-note", quote: "Original notes", startSeconds: null, endSeconds: null }], evidenceStatus: "legacy-unverified" })], "legacy");
  expect(result.rows[0].result.knowledgeIds).toEqual([legacy]); expect(result.rows[0].result.createdItems).toBe(0);
  expect((await db.query<{ description: string }>("select description from ai_links where id=$1", [legacy])).rows[0].description).toBe("Original notes");
 });
 it("binds manual review to the owner and exact hash, retaining missing evidence", async () => {
  await db.query("update marketing_knowledge_items set metadata=jsonb_set(metadata,'{missingParts}','[\"Actual source transcript unverified\"]') where ai_link_id=$1", [legacy]);
  await expect(db.query("select marketing_review_knowledge_item($1,$2,$3,'reviewed')", [other, legacy, "c".repeat(64)])).rejects.toThrow("unavailable");
  await expect(db.query("select marketing_review_knowledge_item($1,$2,$3,'reviewed')", [owner, legacy, "d".repeat(64)])).rejects.toThrow("procedure changed");
  await db.query("select marketing_review_knowledge_item($1,$2,$3,'reviewed')", [owner, legacy, "c".repeat(64)]);
  const reviewed = await db.query<{ review_status: string; reviewed_hash: string; metadata: { missingParts: string[] } }>("select review_status,reviewed_hash,metadata from marketing_knowledge_items where ai_link_id=$1", [legacy]);
  expect(reviewed.rows[0].review_status).toBe("reviewed"); expect(reviewed.rows[0].reviewed_hash).toBe("c".repeat(64)); expect(reviewed.rows[0].metadata.missingParts).toContain("Actual source transcript unverified");
  await db.query("select marketing_review_knowledge_item($1,$2,$3,'needs-review')", [owner, legacy, "c".repeat(64)]);
  expect((await db.query<{ reviewed_at: unknown }>("select reviewed_at from marketing_knowledge_items where ai_link_id=$1", [legacy])).rows[0].reviewed_at).toBeNull();
 });
 it("rolls back sources and events when an unowned link is supplied", async () => {
  await expect(save([source("ROLLBACK")], [item("ROLLBACK", { aiLinkId: foreign })], "foreign-link")).rejects.toThrow("foreign knowledge link");
  expect((await db.query("select * from marketing_knowledge_sources where shortcode='ROLLBACK'")).rows).toHaveLength(0);
  expect((await db.query("select * from marketing_knowledge_events where event_id='foreign-link'")).rows).toHaveLength(0);
 });
 it("rejects each nested foreign project/note/prompt/tool reference even with privileged writes", async () => {
  for (const key of ["projectIds", "noteIds", "promptIds", "toolIds"] as const) {
   await expect(save([], [item("ABC123", { procedureHash: key[0].repeat(64), references: { ...emptyReferences(), [key]: [foreign] } })], `foreign-${key}`)).rejects.toThrow(`foreign knowledge ${key === "projectIds" ? "project" : key === "noteIds" ? "note" : key === "promptIds" ? "prompt" : "tool"}`);
  }
 });
 it("keeps browser tables read-only, RPC service-only and retrieval own-scoped", async () => {
  await save([source("OTHER")], [], "other-owner", other);
  const privileges = await db.query<{ write: boolean; execute: boolean }>("select has_table_privilege('authenticated','marketing_knowledge_sources','INSERT') as write, has_function_privilege('authenticated','marketing_import_knowledge(uuid,jsonb,jsonb,text)','EXECUTE') as execute");
  expect(privileges.rows[0]).toEqual({ write: false, execute: false });
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
  try { expect((await db.query<{ user_id: string }>("select user_id from marketing_knowledge_sources")).rows.every((row) => row.user_id === owner)).toBe(true); }
  finally { await db.exec("reset role"); }
 });
 it("rejects evidence pointing outside an item's owned source joins", async () => {
  await expect(save([source("FORGED")], [item("FORGED", { evidence: [{ shortcode: "OTHER", channel: "caption", quote: "Unrelated", startSeconds: null, endSeconds: null }], procedureHash: "a".repeat(64) })], "forged-evidence")).rejects.toThrow("foreign knowledge evidence");
  expect((await db.query("select * from marketing_knowledge_sources where shortcode='FORGED'")).rows).toHaveLength(0);
 });
 it("claims one durable analysis attempt and cannot overwrite cancelled work with a late callback", async () => {
  const s = { ...source("CLAIM"), status: "queued", analysis_key: "e".repeat(64), analysis_request: { provider: "claude", reviewHash: "e".repeat(64), consentAt: "2026-10-13T00:00:00Z", plan: {}, registration: null } };
  const saved = await save([s], [], "claim-setup"); const id = saved.rows[0].result.sourceIds[0];
  const claim = (user = owner) => db.query<{ result: unknown }>("select marketing_claim_knowledge_analysis($1,$2,$3) as result", [user, id, s.analysis_key]);
  expect((await claim(other)).rows[0].result).toBeNull();
  expect((await claim()).rows[0].result).not.toBeNull(); expect((await claim()).rows[0].result).toBeNull();
  await save([{ ...s, status: "cancelled" }], [], "callback:cancel-claim");
  await expect(save([{ ...s, status: "review" }], [], "callback:late-complete")).rejects.toThrow("analysis cancelled");
  expect((await db.query<{ status: string }>("select status from marketing_knowledge_sources where id=$1", [id])).rows[0].status).toBe("cancelled");
 });
 it("prevents capture retry from resetting queued analysis, preserves the first cutoff, and rejects event conflicts", async () => {
  const queued = { ...source(), status: "queued", analysis_key: "d".repeat(64), budget_usd: 0.25 };
  await save([queued], [], "queue");
  await save([{ ...source(), cutoff: "2026-10-14T00:00:00Z" }], [], "capture-retry");
  const stored = await db.query<{ status: string; analysis_key: string; cutoff: Date }>("select status,analysis_key,cutoff from marketing_knowledge_sources where user_id=$1 and shortcode='ABC123'", [owner]);
  expect(stored.rows[0].status).toBe("queued"); expect(stored.rows[0].analysis_key).toBe("d".repeat(64)); expect(stored.rows[0].cutoff.toISOString()).toContain("2026-10-13");
  await expect(save([], [], "first")).rejects.toThrow("event conflict");
 });
});
