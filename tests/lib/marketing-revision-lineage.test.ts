import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const uuid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const owner = uuid(1); const other = uuid(2); const campaign = uuid(3); const replacementCampaign = uuid(4);
const source = uuid(5); const alternate = uuid(6); const entry = uuid(7); const siblingEntry = uuid(8);
const original = uuid(9); const replacement = uuid(10); const project = uuid(11); const fence = uuid(12);
const foreignCampaign = uuid(13); const foreignEntry = uuid(14); const sha = "a".repeat(64); const editedSha = "b".repeat(64);
const body = (scheduledAt = "2099-10-14T07:00:00Z") => ({ brand: "devshark", caption: "Test-only caption", scheduledAt,
  account: { id: "12345678", platform: "instagram", handle: "test-only-handle" }, sources: [{ sourceId: "question:owned", sourceRevision: "v1", contentHash: sha }], knowledgeIds: [] });
const request = (revisionId = original, calendarEntryId = entry) => ({ calendarEntryId, calendarEntryVersion: 1, generation: { revisionId, scheduledAt: "2099-10-14T07:00:00Z", account: body().account,
  source: { brand: "devshark", sourceId: "question:owned", sourceRevision: "v1", contentHash: sha } } });
async function ownerAction(sql: string, values: unknown[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]); await db.exec("set role authenticated");
  try { return await db.query(sql, values); } finally { await db.exec("reset role"); }
}
const release = () => ownerAction("select marketing_release_calendar_entry($1,$2,$3,'2099-10-15','18:30','carousel')", [entry, sha, alternate]);
const archive = () => ownerAction("select marketing_activate_campaign($1,$2)", [replacementCampaign, editedSha]);
const edit = (previous = original, id = replacement, content = body()) => db.query("select marketing_save_revision($1,$2,$3,$4,true,'[]',$5)", [owner, id, JSON.stringify({ ...content, caption: "Edited test-only caption" }), editedSha, previous]);
const approve = (id = replacement) => ownerAction("select marketing_approve_revision($1,$2) as id", [id, editedSha]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
    insert into auth.users values('${owner}'),('${other}'); insert into public.projects values('${project}','${owner}');`);
  await db.exec(readFileSync("supabase/migrations/20261012225640_marketing_control_surface.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261012232949_marketing_durable_jobs.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate marketing_events,marketing_publications,marketing_revisions,marketing_jobs,marketing_calendar_entries,marketing_source_history,marketing_accounts,marketing_sources,marketing_campaigns");
  await db.query(`insert into marketing_campaigns(id,user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status)
    values($1,$4,'devshark','Original','2099-10-01','2099-10-31','{}',$6,'active'),($2,$4,'devshark','Replacement','2099-10-01','2099-10-31','{}',$7,'draft'),
    ($3,$5,'devshark','Foreign','2099-10-01','2099-10-31','{}',$6,'active')`, [campaign, replacementCampaign, foreignCampaign, owner, other, sha, editedSha]);
  await db.query(`insert into marketing_sources(id,user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible)
    values($1,$3,'devshark','question:owned','v1',$4,'{}',now(),true),($2,$3,'devshark','question:alternate','v1',$4,'{}',now(),true)`, [source, alternate, owner, sha]);
  await db.query(`insert into marketing_calendar_entries(id,user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,needs_review,bound_source_id)
    values($1,$4,$6,'slot','2099-10-14','09:00','carousel','instagram','Test-only slot','{}',false,$8),
    ($2,$4,$6,'sibling','2099-10-14','09:00','carousel','instagram','Sibling slot','{}',false,$8),
    ($3,$5,$7,'foreign','2099-10-14','09:00','carousel','instagram','Foreign slot','{}',false,null)`, [entry, siblingEntry, foreignEntry, owner, other, campaign, foreignCampaign, source]);
  await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,'devshark','instagram','12345678','test-only-handle',now(),true)", [owner]);
});
afterAll(async () => { await db?.close(); });

async function generatedRevision() {
  const queued = await db.query<{ result: { jobId: string } }>("select marketing_enqueue_job($1,$2,$3,$4) as result", [owner, original, sha, JSON.stringify(request())]);
  const job = queued.rows[0].result.jobId;
  await db.query("select marketing_claim_job($1,$2,$3)", [owner, job, fence]);
  await db.query("select marketing_finish_job($1,$2,$3,$4,null)", [owner, job, fence, JSON.stringify({ revision: body(), revisionHash: sha, slides: [] })]);
  await db.query("update marketing_revisions set project_id=$1 where id=$2", [project, original]);
  return job;
}
describe("edited revision lineage cannot escape calendar holds", () => {
  it("attributes worker results directly and inherits project, campaign and entry across multiple owner edits", async () => {
    await generatedRevision();
    expect((await db.query("select calendar_entry_id,campaign_id from marketing_revisions where id=$1", [original])).rows[0]).toEqual({ calendar_entry_id: entry, campaign_id: campaign });
    await edit(); const third = uuid(30); await edit(replacement, third);
    for (const id of [replacement, third]) expect((await db.query("select project_id,campaign_id,calendar_entry_id from marketing_revisions where id=$1", [id])).rows[0]).toEqual({ project_id: project, campaign_id: campaign, calendar_entry_id: entry });
    expect((await db.query("select * from marketing_publications")).rows).toEqual([]);
  });
  it("keeps edited archived content associated so exact new approval remains held", async () => {
    await generatedRevision(); await archive(); await edit();
    await expect(approve()).rejects.toThrow("campaign inactive");
    expect((await db.query("select campaign_id,calendar_entry_id,status,approved_hash from marketing_revisions where id=$1", [replacement])).rows[0]).toEqual({ campaign_id: campaign, calendar_entry_id: entry, status: "review", approved_hash: null });
    expect((await db.query("select * from marketing_publications")).rows).toEqual([]);
  });
  it("rebinds all edited direct revisions while retaining legacy job fallback and leaving another entry alone", async () => {
    // Legacy completed rows had campaign lineage and a job, but no direct entry FK.
    await db.query("insert into marketing_revisions(id,user_id,project_id,campaign_id,brand,revision,content_hash,ready) values($1,$2,$3,$4,'devshark',$5,$6,true)", [original, owner, project, campaign, JSON.stringify(body()), sha]);
    await db.query("insert into marketing_jobs(user_id,idempotency_key,request_hash,request,status) values($1,$2,$3,$4,'review')", [owner, original, sha, JSON.stringify(request())]);
    await edit(); await approve();
    const sibling = uuid(31);
    await db.query("insert into marketing_revisions(id,user_id,campaign_id,calendar_entry_id,brand,revision,content_hash,ready) values($1,$2,$3,$4,'devshark',$5,$6,true)", [sibling, owner, campaign, siblingEntry, JSON.stringify(body()), editedSha]);
    await approve(sibling); await release();
    expect((await db.query("select status,approved_hash,approved_at from marketing_revisions where id=$1", [replacement])).rows[0]).toEqual({ status: "superseded", approved_hash: null, approved_at: null });
    expect((await db.query("select status from marketing_publications where revision_id=$1", [replacement])).rows[0]).toEqual({ status: "cancelled" });
    expect((await db.query("select status from marketing_revisions where id=$1", [sibling])).rows[0]).toEqual({ status: "approved" });
    expect((await db.query("select status from marketing_publications where revision_id=$1", [sibling])).rows[0]).toEqual({ status: "queued" });
    expect((await db.query("select generation_version from marketing_calendar_entries where id=$1", [entry])).rows[0]).toEqual({ generation_version: 2 });
    await expect(approve()).rejects.toThrow("revision not ready");
  });
  it("blocks rebind after the edited replacement itself is claimed, despite having no job with its new revision ID", async () => {
    await generatedRevision(); await edit(original, replacement, body(new Date(Date.now() + 250).toISOString()));
    const approved = await approve(); const publication = (approved.rows[0] as { id: string }).id;
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect((await db.query("select * from marketing_claim_due($1,1,'devshark',$2)", [owner, publication])).rows).toHaveLength(1);
    await expect(release()).rejects.toThrow("entry publication already started");
    expect((await db.query("select generation_version from marketing_calendar_entries where id=$1", [entry])).rows[0]).toEqual({ generation_version: 1 });
    expect((await db.query("select status from marketing_publications where id=$1", [publication])).rows[0]).toEqual({ status: "claimed" });
  });
  it("rejects foreign, wrong-campaign and wrong-brand direct entry lineage even for privileged writers", async () => {
    for (const [linkedEntry, linkedCampaign, brand] of [[foreignEntry, campaign, "devshark"], [entry, replacementCampaign, "devshark"], [entry, campaign, "dneskai"]]) {
      await expect(db.query("insert into marketing_revisions(user_id,campaign_id,calendar_entry_id,brand,revision,content_hash) values($1,$2,$3,$4,$5,$6)", [owner, linkedCampaign, linkedEntry, brand, JSON.stringify(body()), sha])).rejects.toThrow("foreign calendar entry");
    }
  });
  it("keeps independent explicitly approved replacements campaign-free and refuses ambiguous legacy lineage", async () => {
    await db.query("insert into marketing_revisions(id,user_id,project_id,brand,revision,content_hash,ready) values($1,$2,$3,'devshark',$4,$5,true)", [original, owner, project, JSON.stringify(body()), sha]);
    await edit(); await approve();
    expect((await db.query("select project_id,campaign_id,calendar_entry_id from marketing_revisions where id=$1", [replacement])).rows[0]).toEqual({ project_id: project, campaign_id: null, calendar_entry_id: null });
    const ambiguous = uuid(40);
    await db.query("insert into marketing_revisions(id,user_id,campaign_id,brand,revision,content_hash,ready) values($1,$2,$3,'devshark',$4,$5,true)", [ambiguous, owner, campaign, JSON.stringify(body()), sha]);
    for (const linkedEntry of [entry, siblingEntry]) await db.query("insert into marketing_jobs(user_id,idempotency_key,request_hash,request,status) values($1,$2,$3,$4,'review')", [owner, linkedEntry, sha, JSON.stringify(request(ambiguous, linkedEntry))]);
    await expect(edit(ambiguous, uuid(41))).rejects.toThrow("replacement lineage ambiguous");
    expect((await db.query("select status from marketing_revisions where id=$1", [ambiguous])).rows[0]).toEqual({ status: "review" });
  });
});
