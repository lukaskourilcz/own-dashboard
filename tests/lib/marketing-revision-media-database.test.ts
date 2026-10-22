import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { revisionContentHash } from "@/lib/marketing/hashes";
import type { ContentRevision } from "@/lib/marketing/contracts";
import { a, deckRevision, signed } from "./marketing-dneskai-revision-fixture";

// Real migration SQL in an isolated WASM database; every value is synthetic.
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
const original = "33333333-3333-4333-8333-333333333333";
const edited = "44444444-4444-4444-8444-444444444444";
const migrations = ["20261013193104_marketing_control_surface", "20261013193105_marketing_durable_jobs", "20261013193108_marketing_staging_pilot_guard",
  "20261013193131_marketing_offline_import", "20261013193132_marketing_story_receipts", "20261021122551_marketing_revision_media_identity"];
const revision = (): ContentRevision => ({ ...deckRevision(), sources: [{ sourceId: "brief:test-only", sourceRevision: "v1", contentHash: a }] });
const unrendered = (): ContentRevision => ({ ...revision(), caption: "Upravený test-only caption.", assets: [] });
const renewedAssets = (value = revision(), token = "renewed-test-only-token") => value.assets.map((asset, index) => ({ ...asset, url: signed(index + 1, token) }));
const report = (status: "rendered" | "refused", blocking = false) => ({ schemaVersion: "dneskai-render-report/1", status, renderKeys: [], renderedAt: "2026-10-20T10:00:00Z",
  problems: blocking ? [{ slide: 0, code: "image-too-small", blocking: true, message: "test-only" }] : [] });
async function as<T>(role: "authenticated" | "service_role" | null, sub: string | null, run: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [sub ?? ""]);
  if (role) await db.exec(`set role ${role}`);
  try { return await run(); } finally { await db.exec("reset role"); }
}
const approve = (id: string, hash: string) => as("authenticated", owner, () => db.query<{ id: string }>("select marketing_approve_revision($1,$2) as id", [id, hash]));
const renew = (assets: unknown, hash = revisionContentHash(revision()), id = original, user = owner) =>
  db.query<{ r: Record<string, unknown> }>("select marketing_renew_revision_asset_urls($1,$2,$3,$4) as r", [user, id, hash, JSON.stringify(assets)]);
const attach = (content: ContentRevision, ready: boolean, renderReport: unknown, expected = revisionContentHash(unrendered()), hash = revisionContentHash(content)) =>
  db.query("select marketing_attach_revision_render($1,$2,$3,$4,$5,$6,$7)", [owner, edited, expected, JSON.stringify(content), hash, ready, JSON.stringify(renderReport)]);
const row = async (id: string) => (await db.query<{ status: string; ready: boolean; content_hash: string; approved_hash: string | null; replaces_id: string | null; revision: ContentRevision; render_report: unknown }>(
  "select status,ready,content_hash,approved_hash,replaces_id,revision,render_report from marketing_revisions where id=$1", [id])).rows[0]!;
const saveEdit = () => db.query("select marketing_save_revision($1,$2,$3,$4,false,'[]',$5)", [owner, edited, JSON.stringify(unrendered()), revisionContentHash(unrendered()), original]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
  alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  for (const migration of migrations) await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, "utf8"));
}, 60000);
beforeEach(async () => {
  await db.exec("truncate marketing_events,marketing_publications,marketing_revisions,marketing_jobs,marketing_source_history,marketing_accounts,marketing_sources cascade");
  await db.query(`insert into marketing_sources(user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible) values($1,'dneskai','brief:test-only','v1',$2,'{}',now(),true)`, [owner, a]);
  await db.query(`insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,'dneskai','instagram',$2,$3,now(),true)`, [owner, revision().account.id, revision().account.handle]);
  await db.query("insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready) values($1,$2,'dneskai',$3,$4,true)", [original, owner, JSON.stringify(revision()), revisionContentHash(revision())]);
});
afterAll(async () => { await db?.close(); });

describe("revision media identity in SQL (#118)", () => {
  it("keeps renewal and render attachment service-only and leaves the helpers private", async () => {
    for (const signature of ["marketing_renew_revision_asset_urls(uuid,uuid,text,jsonb)", "marketing_attach_revision_render(uuid,uuid,text,jsonb,text,boolean,jsonb)", "marketing_private.revision_without_urls(jsonb)", "marketing_private.render_report_blocks(jsonb)"]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [signature]);
      expect(rows[0], signature).toEqual({ anon: false, authenticated: false, service: true });
    }
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>("select has_function_privilege('anon','marketing_approve_revision(uuid,text)','EXECUTE') anon,has_function_privilege('authenticated','marketing_approve_revision(uuid,text)','EXECUTE') authenticated");
    expect(rows[0]).toEqual({ anon: false, authenticated: true });
  });

  it("renews URLs of an approved revision in place and keeps its hash, approval and queued publication", async () => {
    const hash = revisionContentHash(revision());
    const publication = (await approve(original, hash)).rows[0]!.id;
    const result = (await as("service_role", null, () => renew(renewedAssets()))).rows[0]!.r;
    expect(result).toMatchObject({ revisionId: original, contentHash: hash, approvedHash: hash, status: "approved", renewed: 3 });
    const stored = await row(original);
    expect(stored).toMatchObject({ status: "approved", ready: true, content_hash: hash, approved_hash: hash });
    expect(stored.revision.assets.map((asset) => asset.url)).toEqual(renewedAssets().map((asset) => asset.url));
    expect(revisionContentHash(stored.revision)).toBe(hash);
    expect((await db.query<{ status: string }>("select status from marketing_publications where id=$1", [publication])).rows[0]!.status).toBe("queued");
    expect((await db.query<{ count: number }>("select count(*)::int count from marketing_revisions")).rows[0]!.count).toBe(1);
    expect((await approve(original, hash)).rows[0]!.id).toBe(publication);
  });

  it("refuses a renewal that changes anything but the signature of the same objects", async () => {
    const before = await row(original);
    const swap = (patch: (assets: ReturnType<typeof renewedAssets>) => unknown) => patch(renewedAssets());
    const refusals: Array<[unknown, string]> = [
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, sha256: "9".repeat(64) } : asset)), "renewal changes more than urls"],
      [swap((assets) => assets.map((asset, i) => i === 1 ? { ...asset, alt: "Jiný alt" } : asset)), "renewal changes more than urls"],
      [swap((assets) => assets.map((asset, i) => i === 2 ? { ...asset, width: 1080, height: 1080 } : asset)), "renewal changes more than urls"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, extra: true } : asset)), "renewal changes more than urls"],
      [swap((assets) => [assets[1], assets[0], assets[2]]), "renewal changes more than urls"],
      [swap((assets) => assets.slice(0, 2)), "renewal changes more than urls"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: signed(2, "renewed-test-only-token") } : asset)), "renewal url untrusted"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: asset.url.replace("https://", "http://") } : asset)), "renewal url untrusted"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: asset.url.replace("test-only.supabase.co", "evil.example") } : asset)), "renewal url untrusted"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: asset.url.replace("/sign/", "/public/") } : asset)), "renewal url untrusted"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: `${asset.url}&download=1` } : asset)), "renewal url untrusted"],
      [swap((assets) => assets.map((asset, i) => i === 0 ? { ...asset, url: null } : asset)), "renewal input invalid"],
      [[], "renewal input invalid"],
    ];
    for (const [assets, message] of refusals) await expect(as("service_role", null, () => renew(assets)), message).rejects.toThrow(message);
    await expect(renew(renewedAssets(), "0".repeat(64))).rejects.toThrow("revision changed");
    await expect(renew(renewedAssets(), undefined, original, other)).rejects.toThrow("revision unavailable");
    expect(await row(original)).toEqual(before);
  });

  it("supersedes on edit, so the old approval cannot be used and the new revision waits for its render", async () => {
    const oldHash = revisionContentHash(revision());
    await approve(original, oldHash);
    await saveEdit();
    expect(await row(original)).toMatchObject({ status: "superseded", approved_hash: null });
    expect((await db.query<{ status: string }>("select status from marketing_publications")).rows.map((r) => r.status)).toEqual(["cancelled"]);
    await expect(approve(original, oldHash)).rejects.toThrow("revision not ready");
    await expect(renew(renewedAssets(), oldHash)).rejects.toThrow("revision not renewable");
    const pending = await row(edited);
    expect(pending).toMatchObject({ status: "review", ready: false, replaces_id: original, render_report: null });
    await expect(approve(edited, pending.content_hash)).rejects.toThrow("revision not ready");
  });

  it("attaches only rendered assets, records refusals and approves the rendered hash", async () => {
    await saveEdit();
    const rendered: ContentRevision = { ...unrendered(), assets: revision().assets };
    await expect(attach({ ...rendered, caption: "Podstrčený caption." }, true, report("rendered"))).rejects.toThrow("render may only attach assets");
    await expect(attach({ ...rendered, deck: { ...rendered.deck!, slides: rendered.deck!.slides.slice(0, 2) } }, true, report("rendered"))).rejects.toThrow("render may only attach assets");
    await expect(attach({ ...rendered, assets: rendered.assets.slice(0, 2) }, true, report("rendered"))).rejects.toThrow("render incomplete");
    await expect(attach(rendered, true, report("rendered", true))).rejects.toThrow("render incomplete");
    await expect(attach(rendered, true, report("refused"))).rejects.toThrow("render incomplete");
    await expect(attach(rendered, false, report("refused", true))).rejects.toThrow("unready render attaches nothing");
    await expect(attach(rendered, true, report("rendered"), "0".repeat(64))).rejects.toThrow("revision changed");

    await attach(unrendered(), false, report("refused", true));
    expect(await row(edited)).toMatchObject({ ready: false, content_hash: revisionContentHash(unrendered()), render_report: report("refused", true) });
    await expect(approve(edited, revisionContentHash(unrendered()))).rejects.toThrow("revision not ready");

    await attach(rendered, true, report("rendered"));
    const finalHash = revisionContentHash(rendered);
    expect(await row(edited)).toMatchObject({ status: "review", ready: true, content_hash: finalHash, render_report: report("rendered") });
    await expect(attach(rendered, true, report("rendered"), finalHash)).rejects.toThrow("revision not renderable");
    await expect(approve(edited, revisionContentHash(unrendered()))).rejects.toThrow("revision changed");
    await approve(edited, finalHash);
    expect(await row(edited)).toMatchObject({ status: "approved", approved_hash: finalHash });
  });

  it("holds approval for a blocking render report or a deck whose assets do not match its slides", async () => {
    const hash = revisionContentHash(revision());
    await db.query("update marketing_revisions set render_report=$2 where id=$1", [original, JSON.stringify(report("rendered", true))]);
    await expect(approve(original, hash)).rejects.toThrow("render blocked");
    await db.query("update marketing_revisions set render_report=$2 where id=$1", [original, JSON.stringify({ schemaVersion: "dneskai-render-report/1", status: "rendered", problems: [{ slide: 1, code: "x", message: "missing flag" }] })]);
    await expect(approve(original, hash)).rejects.toThrow("render blocked");
    const short = { ...revision(), assets: revision().assets.slice(0, 2) };
    await db.query("update marketing_revisions set render_report=null,revision=$2,content_hash=$3 where id=$1", [original, JSON.stringify(short), revisionContentHash(short)]);
    await expect(approve(original, revisionContentHash(short))).rejects.toThrow("revision not ready");
  });
});
