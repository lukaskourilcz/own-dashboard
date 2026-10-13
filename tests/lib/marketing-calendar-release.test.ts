import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const uuid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const owner = uuid(1); const other = uuid(2); const campaign = uuid(3); const foreignCampaign = uuid(4);
const source = uuid(5); const foreignSource = uuid(6); const wrongBrandSource = uuid(7); const expiredSource = uuid(8); const ineligibleSource = uuid(9);
const entry = uuid(10); const otherEntry = uuid(11); const foreignEntry = uuid(12);
const sha = "a".repeat(64);
const release = (patch: { owner?: string; entry?: string; hash?: string; source?: string; date?: string; time?: string; kind?: string } = {}) => asOwner(patch.owner ?? owner, () => db.query("select marketing_release_calendar_entry($1,$2,$3,$4,$5,$6)", [patch.entry ?? entry, patch.hash ?? sha, patch.source ?? source, patch.date ?? "2026-10-15", patch.time ?? "18:30", patch.kind ?? "carousel"]));
async function asOwner<T>(user: string, action: () => Promise<T>): Promise<T> {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
  await db.exec("set role authenticated");
  try { return await action(); } finally { await db.exec("reset role"); }
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
    create table public.projects(id uuid primary key,user_id uuid not null);
    create table public.ai_links(id uuid primary key,user_id uuid not null);
    insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync("supabase/migrations/20261012225640_marketing_control_surface.sql", "utf8"));
  await db.exec(readFileSync("supabase/migrations/20261012232949_marketing_durable_jobs.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec("truncate marketing_events,marketing_publications,marketing_revisions,marketing_jobs,marketing_calendar_entries,marketing_source_history,marketing_accounts,marketing_sources,marketing_campaigns");
  await db.query(`insert into marketing_campaigns(id,user_id,brand,name,starts_on,ends_on,source_snapshot,source_hash,status)
    values($1,$2,'devshark','Owned campaign','2026-10-01','2026-10-31','{}',$5,'active'),($3,$4,'devshark','Foreign campaign','2026-10-01','2026-10-31','{}',$5,'active')`, [campaign, owner, foreignCampaign, other, sha]);
  await db.query(`insert into marketing_sources(id,user_id,brand,source_id,source_revision,content_hash,packet,observed_at,expires_at,eligible)
    values($1,$6,'devshark','question:owned','v1',$8,'{}',now(),null,true),($2,$7,'devshark','question:foreign','v1',$8,'{}',now(),null,true),
    ($3,$6,'dneskai','feature:wrong-brand','v1',$8,'{}',now(),null,true),($4,$6,'devshark','question:expired','v1',$8,'{}',now(),now()-interval '1 minute',true),
    ($5,$6,'devshark','question:ineligible','v1',$8,'{}',now(),null,false)`, [source, foreignSource, wrongBrandSource, expiredSource, ineligibleSource, owner, other, sha]);
  await db.query(`insert into marketing_calendar_entries(id,user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,status,needs_review,generation_version)
    values($1,$4,$6,'slot:first','2026-10-14','09:00','video','instagram','First','{}','planned',true,1),
    ($2,$4,$6,'slot:second','2026-10-14','10:00','carousel','instagram','Second','{}','planned',false,7),
    ($3,$5,$7,'slot:foreign','2026-10-14','10:00','carousel','instagram','Foreign','{}','planned',false,1)`, [entry, otherEntry, foreignEntry, owner, other, campaign, foreignCampaign]);
  await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at) values($1,'devshark','instagram','test-only-account','test-only-handle',now())", [owner]);
});
afterAll(async () => { await db?.close(); });

async function revision(id: string, calendarEntryId: string, approved = false) {
  const content = { brand: "devshark", scheduledAt: new Date(Date.now() + 3600000).toISOString(), account: { id: "test-only-account", platform: "instagram", handle: "test-only-handle" },
    sources: [{ sourceId: "question:owned", sourceRevision: "v1", contentHash: sha }], knowledgeIds: [] };
  await db.query("insert into marketing_revisions(id,user_id,campaign_id,brand,revision,content_hash,ready) values($1,$2,$3,'devshark',$4,$5,true)", [id, owner, campaign, JSON.stringify(content), sha]);
  const jobId = uuid(Number.parseInt(id.slice(0, 8), 16) + 100);
  const version = calendarEntryId === entry ? 1 : 7;
  const scheduledAt = calendarEntryId === entry ? "2026-10-14T07:00:00Z" : "2026-10-14T08:00:00Z";
  await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request) values($1,$2,$3,$4,$5)", [jobId, owner, id, sha, JSON.stringify({ calendarEntryId, calendarEntryVersion: version, generation: { revisionId: id, scheduledAt, account: { platform: "instagram" }, source: { brand: "devshark", sourceId: "question:owned", sourceRevision: "v1", contentHash: sha } } })]);
  if (approved) await asOwner(owner, () => db.query("select marketing_approve_revision($1,$2)", [id, sha]));
  return jobId;
}
describe("actual calendar binding and release SQL", () => {
  it("rejects foreign campaigns and foreign or wrong-brand source bindings even for privileged writes", async () => {
    await expect(db.query("update marketing_calendar_entries set campaign_id=$1 where id=$2", [foreignCampaign, entry])).rejects.toThrow("foreign campaign");
    for (const unowned of [foreignSource, wrongBrandSource]) await expect(db.query("update marketing_calendar_entries set bound_source_id=$1 where id=$2", [unowned, entry])).rejects.toThrow("foreign bound source");
    const stored = await db.query("select campaign_id,bound_source_id,generation_version from marketing_calendar_entries where id=$1", [entry]);
    expect(stored.rows[0]).toEqual({ campaign_id: campaign, bound_source_id: null, generation_version: 1 });
  });
  it("holds wrong-owner, stale-campaign, out-of-window, invalid-time and unavailable-source releases without mutation", async () => {
    await expect(release({ owner: other })).rejects.toThrow("entry unavailable");
    await expect(release({ hash: "b".repeat(64) })).rejects.toThrow("campaign changed");
    await expect(release({ date: "2026-11-01" })).rejects.toThrow("campaign changed");
    await expect(release({ time: "25:00" })).rejects.toThrow("entry not releasable");
    await expect(release({ kind: "thread" })).rejects.toThrow("entry not releasable");
    for (const unavailable of [foreignSource, wrongBrandSource, expiredSource, ineligibleSource]) await expect(release({ source: unavailable })).rejects.toThrow("current source required");
    expect((await db.query("select generation_version,bound_source_id,needs_review from marketing_calendar_entries where id=$1", [entry])).rows[0]).toEqual({ generation_version: 1, bound_source_id: null, needs_review: true });
  });
  it("cancels only this entry's queued publication, invalidates its revisions and fences its running worker", async () => {
    const targetRevision = uuid(20); const targetPendingRevision = uuid(21); const siblingRevision = uuid(22);
    const targetJob = await revision(targetRevision, entry, true); const pendingJob = await revision(targetPendingRevision, entry);
    const siblingJob = await revision(siblingRevision, otherEntry, true); const fence = uuid(30); const siblingFence = uuid(31);
    // This slot had already been released before the work started.
    await db.query("update marketing_calendar_entries set needs_review=false where id=$1", [entry]);
    await db.query("update marketing_jobs set status='review' where id=$1", [targetJob]);
    await db.query("select marketing_claim_job($1,$2,$3)", [owner, pendingJob, fence]);
    await db.query("select marketing_claim_job($1,$2,$3)", [owner, siblingJob, siblingFence]);
    const before = (await db.query("select * from marketing_calendar_entries where id=$1", [otherEntry])).rows[0];
    const approvalCount = (await db.query<{ count: number }>("select count(*)::int as count from marketing_events where kind='approved'")).rows[0].count;
    await release();
    expect((await db.query("select bound_source_id,date::text,local_time,kind,status,needs_review,generation_version from marketing_calendar_entries where id=$1", [entry])).rows[0]).toEqual({ bound_source_id: source, date: "2026-10-15", local_time: "18:30", kind: "carousel", status: "planned", needs_review: false, generation_version: 2 });
    expect((await db.query("select * from marketing_calendar_entries where id=$1", [otherEntry])).rows[0]).toEqual(before);
    const statuses = await db.query<{ revision_id: string; status: string }>("select revision_id,status from marketing_publications order by revision_id");
    expect(statuses.rows).toEqual([{ revision_id: targetRevision, status: "cancelled" }, { revision_id: siblingRevision, status: "queued" }]);
    expect((await db.query("select status,approved_hash,approved_at from marketing_revisions where id=$1", [targetRevision])).rows[0]).toEqual({ status: "superseded", approved_hash: null, approved_at: null });
    expect((await db.query("select status from marketing_revisions where id=$1", [targetPendingRevision])).rows[0]).toEqual({ status: "superseded" });
    expect((await db.query("select status,approved_hash from marketing_revisions where id=$1", [siblingRevision])).rows[0]).toEqual({ status: "approved", approved_hash: sha });
    expect((await db.query("select status,error_code,fence,lease_until from marketing_jobs where id=$1", [pendingJob])).rows[0]).toEqual({ status: "reconciliation", error_code: "calendar-entry-rebound", fence: null, lease_until: null });
    expect((await db.query("select status,fence from marketing_jobs where id=$1", [siblingJob])).rows[0]).toEqual({ status: "running", fence: siblingFence });
    await expect(db.query("select marketing_finish_job($1,$2,$3,$4,$5)", [owner, pendingJob, fence, null, "late-worker-failure"])).rejects.toThrow("job fence lost");
    expect((await db.query<{ count: number }>("select count(*)::int as count from marketing_events where kind='approved'")).rows[0].count).toBe(approvalCount);
    expect((await db.query<{ count: number }>("select count(*)::int as count from marketing_publications")).rows[0].count).toBe(2);
  });
  it("marks an exact entry's queued job failed while release creates no future approval or publication", async () => {
    const job = await revision(uuid(24), entry);
    await release();
    expect((await db.query("select status,error_code from marketing_jobs where id=$1", [job])).rows[0]).toEqual({ status: "failed", error_code: "calendar-entry-rebound" });
    expect((await db.query("select * from marketing_publications")).rows).toEqual([]);
    expect((await db.query("select * from marketing_events where kind='approved'")).rows).toEqual([]);
    expect((await db.query("select * from marketing_revisions where status='approved'")).rows).toEqual([]);
  });
  it("refuses to rebind after claimed, reconciliation or published remote work without invalidating local state", async () => {
    const id = uuid(25); const job = await revision(id, entry, true);
    for (const status of ["claimed", "reconciliation", "published"]) {
      await db.query("update marketing_publications set status=$1 where revision_id=$2", [status, id]);
      await expect(release()).rejects.toThrow("entry publication already started");
      expect((await db.query("select generation_version from marketing_calendar_entries where id=$1", [entry])).rows[0]).toEqual({ generation_version: 1 });
      expect((await db.query("select status from marketing_jobs where id=$1", [job])).rows[0]).toEqual({ status: "queued" });
      expect((await db.query("select status,approved_hash from marketing_revisions where id=$1", [id])).rows[0]).toEqual({ status: "approved", approved_hash: sha });
    }
  });
  it("allows only the bounded owner RPC, never direct authenticated binding writes", async () => {
    await asOwner(owner, async () => {
      await expect(db.query("update marketing_calendar_entries set bound_source_id=$1 where id=$2", [source, entry])).rejects.toThrow("permission denied");
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege('authenticated','marketing_release_calendar_entry(uuid,text,uuid,date,text,text)','EXECUTE') as allowed")).rows[0].allowed).toBe(true);
      expect((await db.query<{ allowed: boolean }>("select has_function_privilege('anon','marketing_release_calendar_entry(uuid,text,uuid,date,text,text)','EXECUTE') as allowed")).rows[0].allowed).toBe(false);
    });
  });
});
