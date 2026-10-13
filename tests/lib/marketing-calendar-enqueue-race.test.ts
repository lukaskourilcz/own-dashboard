import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

let db: PGlite;
const uuid = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
const owner = uuid(1); const other = uuid(2); const campaign = uuid(3); const replacement = uuid(4);
const source = uuid(5); const alternative = uuid(6); const entry = uuid(7); const key = uuid(8); const fence = uuid(9);
const sha = "a".repeat(64);
const request = () => ({ calendarEntryId: entry, calendarEntryVersion: 1, generation: { revisionId: key, scheduledAt: "2026-10-14T07:00:00Z", account: { platform: "instagram" },
  source: { brand: "devshark", sourceId: "question:owned", sourceRevision: "v1", contentHash: sha } } });
const enqueue = (value: unknown = request(), hash = sha) => db.query<{ result: { jobId: string; status: string; duplicate: boolean } }>("select marketing_enqueue_job($1,$2,$3,$4) as result", [owner, key, hash, JSON.stringify(value)]);
const claim = (job: string) => db.query<{ result: unknown }>("select marketing_claim_job($1,$2,$3) as result", [owner, job, fence]);
const finish = (job: string, value: unknown = null, error: string | null = null) => db.query<{ result: string }>("select marketing_finish_job($1,$2,$3,$4,$5) as result", [owner, job, fence, value === null ? null : JSON.stringify(value), error]);
async function ownerAction(sql: string, values: unknown[]) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
  await db.exec("set role authenticated");
  try { return await db.query(sql, values); } finally { await db.exec("reset role"); }
}
const release = () => ownerAction("select marketing_release_calendar_entry($1,$2,$3,'2026-10-15','18:30','carousel')", [entry, sha, alternative]);
const archiveByActivatingReplacement = () => ownerAction("select marketing_activate_campaign($1,$2)", [replacement, "b".repeat(64)]);
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key);
    create role anon; create role authenticated; create role service_role bypassrls;
    -- Supabase gives these default grants directly; PUBLIC-only revokes are insufficient.
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
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
    values($1,$3,'devshark','Original','2026-10-01','2026-10-31','{}',$4,'active'),($2,$3,'devshark','Replacement','2026-10-01','2026-10-31','{}',$5,'draft')`, [campaign, replacement, owner, sha, "b".repeat(64)]);
  await db.query(`insert into marketing_sources(id,user_id,brand,source_id,source_revision,content_hash,packet,observed_at,eligible)
    values($1,$3,'devshark','question:owned','v1',$4,'{}',now(),true),($2,$3,'devshark','question:alternative','v1',$4,'{}',now(),true)`, [source, alternative, owner, sha]);
  await db.query(`insert into marketing_calendar_entries(id,user_id,campaign_id,source_id,date,local_time,kind,platform,title,original,status,needs_review,bound_source_id)
    values($1,$2,$3,'slot','2026-10-14','09:00','carousel','instagram','Test-only slot','{}','planned',false,$4)`, [entry, owner, campaign, source]);
  await db.query("insert into marketing_accounts(user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,'devshark','instagram','12345678','test-only-handle',now(),true)", [owner]);
});
afterAll(async () => { await db?.close(); });
async function readyRevision(id: string, associatedCampaign: string | null, milliseconds = 3600000) {
  const content = { brand: "devshark", scheduledAt: new Date(Date.now() + milliseconds).toISOString(),
    account: { id: "12345678", platform: "instagram", handle: "test-only-handle" }, sources: [request().generation.source], knowledgeIds: [] };
  await db.query("insert into marketing_revisions(id,user_id,campaign_id,brand,revision,content_hash,ready) values($1,$2,$3,'devshark',$4,$5,true)", [id, owner, associatedCampaign, JSON.stringify(content), sha]);
}
async function approvedDuePublication(associatedCampaign: string | null = campaign) {
  const id = uuid(70); await readyRevision(id, associatedCampaign, 250);
  const approved = await ownerAction("select marketing_approve_revision($1,$2) as id", [id, sha]);
  const publication = (approved.rows[0] as { id: string }).id;
  await new Promise((resolve) => setTimeout(resolve, 300));
  return publication;
}
const claimPublication = (publication: string) => db.query("select * from marketing_claim_due($1,1,'devshark',$2)", [owner, publication]);
const checkpoint = (publication: string, expectedContainer: string | null, expectedError: string | null, container: string, error: string) => db.query("select marketing_checkpoint_publication($1,$2,$3,$4,$5,$6)", [owner, publication, expectedContainer, expectedError, container, error]);
describe("calendar snapshot fencing across enqueue, claim and finish", () => {
  it("rejects an old read that enqueues after release commits; accepts only the new exact slot/source snapshot", async () => {
    const delayed = request(); // The orchestrator read occurs before owner release.
    await release();
    await expect(enqueue(delayed)).rejects.toThrow("calendar entry unavailable");
    expect((await db.query("select * from marketing_jobs")).rows).toEqual([]);
    const current = request(); current.calendarEntryVersion = 2; current.generation.scheduledAt = "2026-10-15T16:30:00Z"; current.generation.source.sourceId = "question:alternative";
    expect((await enqueue(current)).rows[0].result).toMatchObject({ status: "queued", duplicate: false });
  });
  it("does not accept forged paired versions, platform, schedule or source identities against the locked entry", async () => {
    const invalid: unknown[] = [
      { ...request(), calendarEntryVersion: undefined }, { calendarEntryVersion: 1, generation: request().generation },
      { ...request(), calendarEntryVersion: 2 }, { ...request(), calendarEntryId: uuid(50) },
      { ...request(), generation: { ...request().generation, account: { platform: "threads" } } },
      { ...request(), generation: { ...request().generation, scheduledAt: "2026-10-14T08:00:00Z" } },
      { ...request(), generation: { ...request().generation, source: { ...request().generation.source, sourceId: "question:alternative" } } },
      { ...request(), generation: { ...request().generation, source: { ...request().generation.source, sourceRevision: "v2" } } },
      { ...request(), generation: { ...request().generation, source: { ...request().generation.source, contentHash: "c".repeat(64) } } },
    ];
    for (const value of invalid) await expect(enqueue(value)).rejects.toThrow("calendar entry unavailable");
    await db.query("update marketing_sources set expires_at=now()-interval '1 minute' where id=$1", [source]);
    await expect(enqueue()).rejects.toThrow("calendar entry unavailable");
    expect((await db.query("select * from marketing_jobs")).rows).toEqual([]);
  });
  it("returns the original idempotent job after archival but cannot claim it or create another paid attempt", async () => {
    const first = (await enqueue()).rows[0].result;
    await archiveByActivatingReplacement();
    const duplicate = (await enqueue()).rows[0].result;
    expect(duplicate).toEqual({ ...first, duplicate: true });
    await expect(enqueue(request(), "c".repeat(64))).rejects.toThrow("job identity conflict");
    expect((await claim(first.jobId)).rows[0].result).toBeNull();
    expect((await db.query("select status,error_code,fence,lease_until from marketing_jobs where id=$1", [first.jobId])).rows[0]).toEqual({ status: "failed", error_code: "calendar-entry-changed", fence: null, lease_until: null });
    expect((await claim(first.jobId)).rows[0].result).toBeNull();
    expect((await db.query("select * from marketing_revisions")).rows).toEqual([]);
  });
  it("records reconciliation rather than a ready revision when the campaign is archived during execution", async () => {
    const job = (await enqueue()).rows[0].result.jobId;
    expect((await claim(job)).rows[0].result).toEqual(request());
    await archiveByActivatingReplacement();
    expect((await finish(job, { revision: {}, revisionHash: sha, slides: [] })).rows[0].result).toBe("reconciliation");
    expect((await db.query("select status,error_code,fence,lease_until,result from marketing_jobs where id=$1", [job])).rows[0]).toEqual({ status: "reconciliation", error_code: "calendar-entry-changed", fence: null, lease_until: null, result: null });
    await expect(finish(job)).rejects.toThrow("job fence lost");
    expect((await db.query("select * from marketing_revisions")).rows).toEqual([]);
    expect((await db.query("select * from marketing_publications")).rows).toEqual([]);
  });
  it("fences a current source change between claim and finish, and refuses a late rebind result", async () => {
    const job = (await enqueue()).rows[0].result.jobId; await claim(job);
    await db.query("update marketing_sources set source_revision='v2' where id=$1", [source]);
    expect((await finish(job, { revision: {}, revisionHash: sha, slides: [] })).rows[0].result).toBe("reconciliation");
    expect((await db.query("select * from marketing_revisions")).rows).toEqual([]);
    await db.query("update marketing_sources set source_revision='v1' where id=$1", [source]);
    const next = uuid(40); await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request) values($1,$2,$3,$4,$5)", [next, owner, uuid(41), sha, JSON.stringify(request())]);
    await claim(next); await release();
    await expect(finish(next, { revision: {}, revisionHash: sha, slides: [] })).rejects.toThrow("job fence lost");
    expect((await db.query("select * from marketing_revisions")).rows).toEqual([]);
  });
  it("finishes a current snapshot only as owner review, preserving campaign attribution without creating approval", async () => {
    const job = (await enqueue()).rows[0].result.jobId; await claim(job);
    const revision = { brand: "devshark", sources: [request().generation.source], knowledgeIds: [] };
    expect((await finish(job, { revision, revisionHash: sha, slides: [] })).rows[0].result).toBe("review");
    expect((await db.query("select campaign_id,status,approved_hash from marketing_revisions where id=$1", [key])).rows[0]).toEqual({ campaign_id: campaign, status: "review", approved_hash: null });
    expect((await db.query("select * from marketing_publications")).rows).toEqual([]);
    expect((await db.query("select * from marketing_events where kind='approved'")).rows).toEqual([]);
  });
  it("keeps generic jobs unchanged and explicitly revokes the calendar helper and worker functions from browser roles", async () => {
    const generic = (await enqueue({})).rows[0].result.jobId; await claim(generic);
    expect((await finish(generic, null, "test-only-provider-failure")).rows[0].result).toBe("failed");
    for (const signature of ["marketing_revision_campaign_active(uuid,uuid,uuid)", "marketing_calendar_job_current(uuid,jsonb)", "marketing_enqueue_job(uuid,uuid,text,jsonb)", "marketing_claim_job(uuid,uuid,uuid)", "marketing_finish_job(uuid,uuid,uuid,jsonb,text)"]) {
      for (const role of ["anon", "authenticated"]) {
        const permission = await db.query<{ allowed: boolean }>("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, signature]);
        expect(permission.rows[0].allowed).toBe(false);
      }
    }
  });
  it("runs the guarded calendar enqueue with the real service-role bypass and preserves own source scope", async () => {
    await db.exec("set role service_role");
    try {
      expect((await enqueue()).rows[0].result.status).toBe("queued");
      await expect(db.query("select marketing_enqueue_job($1,$2,$3,$4)", [other, uuid(60), sha, JSON.stringify(request())])).rejects.toThrow("calendar entry unavailable");
    } finally { await db.exec("reset role"); }
  });
});
describe("archived campaign approval and remote intent fencing", () => {
  it("holds new approval and existing approved queued publications after an owner switches plans", async () => {
    const publication = await approvedDuePublication();
    const unapproved = uuid(71); await readyRevision(unapproved, campaign);
    await archiveByActivatingReplacement();
    await expect(ownerAction("select marketing_approve_revision($1,$2)", [unapproved, sha])).rejects.toThrow("campaign inactive");
    expect((await claimPublication(publication)).rows).toEqual([]);
    expect((await db.query("select status,remote_media_id from marketing_publications where id=$1", [publication])).rows[0]).toEqual({ status: "queued", remote_media_id: null });
  });
  it("blocks container creation when archival commits after claim but before the first remote intent", async () => {
    const publication = await approvedDuePublication(); expect((await claimPublication(publication)).rows).toHaveLength(1);
    await archiveByActivatingReplacement();
    await expect(checkpoint(publication, null, null, `intent:${sha}`, "container-create-intent")).rejects.toThrow("publication no longer authorized");
    expect((await db.query("select remote_container_id,error_code from marketing_publications where id=$1", [publication])).rows[0]).toEqual({ remote_container_id: null, error_code: null });
  });
  it("blocks final publish intent after archival while preserving actual remote receipt reconciliation", async () => {
    const publication = await approvedDuePublication(); await claimPublication(publication);
    await checkpoint(publication, null, null, `intent:${sha}`, "container-create-intent");
    await checkpoint(publication, `intent:${sha}`, "container-create-intent", "123", "container-pending");
    await archiveByActivatingReplacement();
    await expect(checkpoint(publication, "123", "container-pending", "123", "publish-intent")).rejects.toThrow("publication no longer authorized");
    await db.query("select marketing_finish_publication($1,$2,$3,$4,'reconciliation',$3,'456',null,'test-only-observed-receipt')", [owner, publication, "123", "container-pending"]);
    await db.query("select marketing_finish_publication($1,$2,$3,$4,'published',$3,'456','https://www.instagram.com/p/test-only-reconciled/',null)", [owner, publication, "123", "test-only-observed-receipt"]);
    expect((await db.query("select status,remote_container_id,remote_media_id from marketing_publications where id=$1", [publication])).rows[0]).toEqual({ status: "published", remote_container_id: "123", remote_media_id: "456" });
  });
  it("keeps separately approved campaign-free revisions eligible after a plan switch", async () => {
    const publication = await approvedDuePublication(null);
    await archiveByActivatingReplacement();
    expect((await claimPublication(publication)).rows).toHaveLength(1);
    await checkpoint(publication, null, null, `intent:${sha}`, "container-create-intent");
    expect((await db.query("select status from marketing_revisions where id=$1", [uuid(70)])).rows[0]).toEqual({ status: "publishing" });
  });
});
