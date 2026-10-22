import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The unapplied approval-04 migration in PGlite on top of the deployed publication SQL. No production database.
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(64);
let next = 0;
const uuid = () => `${String(++next).padStart(8, '0')}-0000-4000-8000-000000000000`;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.projects(id uuid primary key,user_id uuid not null);
  create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync('supabase/migrations/20261012225640_marketing_control_surface.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261012232949_marketing_durable_jobs.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261022110000_marketing_requeue_unpublished_publication.sql', 'utf8'));
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [owner]);
}, 30000);
afterAll(async () => { await db?.close(); });

type Publication = { status: string; remote_container_id: string | null; remote_media_id: string | null; remote_url: string | null; error_code: string | null; lease_until: string | null; scheduled_at: string };
async function stranded(patch: Partial<Publication> = {}, revision: { status?: string; approved_hash?: string | null; user?: string } = {}) {
  const revisionId = uuid(); const publicationId = uuid(); const user = revision.user ?? owner;
  const approvedAt = '2026-10-20T06:00:00Z';
  await db.query(`insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready,status,approved_at,approved_hash) values($1,$2,'dneskai','{}',$3,true,$4,$5,$6)`,
    [revisionId, user, sha, revision.status ?? 'reconciliation', approvedAt, revision.approved_hash === undefined ? sha : revision.approved_hash]);
  const row: Publication = { status: 'reconciliation', remote_container_id: `intent:${sha}`, remote_media_id: null, remote_url: null, error_code: 'container-identity-unavailable',
    lease_until: null, scheduled_at: new Date(Date.now() + 60_000).toISOString(), ...patch };
  await db.query(`insert into marketing_publications(id,user_id,revision_id,platform,status,remote_container_id,remote_media_id,remote_url,error_code,lease_until,scheduled_at,last_checked_at)
    values($1,$2,$3,'instagram',$4,$5,$6,$7,$8,$9,$10,now())`, [publicationId, user, revisionId, row.status, row.remote_container_id, row.remote_media_id, row.remote_url, row.error_code, row.lease_until, row.scheduled_at]);
  return { revisionId, publicationId };
}
const requeue = (id: string) => db.query<{ result: string }>('select marketing_requeue_publication($1) result', [id]);
const publication = async (id: string) => (await db.query<Publication & { last_checked_at: string | null }>('select * from marketing_publications where id=$1', [id])).rows[0]!;
const revision = async (id: string) => (await db.query<{ status: string; approved_at: string; approved_hash: string | null; content_hash: string }>('select status,approved_at,approved_hash,content_hash from marketing_revisions where id=$1', [id])).rows[0]!;

describe('marketing_requeue_publication (approval-04)', () => {
  it('returns a post stranded by the old container-create intent to approved and queued without touching its approval', async () => {
    const { revisionId, publicationId } = await stranded();
    const before = await revision(revisionId);
    expect((await requeue(publicationId)).rows[0]!.result).toBe('queued');
    expect(await publication(publicationId)).toMatchObject({ status: 'queued', remote_container_id: null, remote_media_id: null, remote_url: null, error_code: 'owner-requeued', lease_until: null, last_checked_at: null });
    expect(await revision(revisionId)).toEqual({ ...before, status: 'approved' });
    const events = await db.query<{ kind: string; payload: Record<string, unknown> }>('select kind,payload from marketing_events where revision_id=$1', [revisionId]);
    expect(events.rows).toEqual([{ kind: 'requeued', payload: { publicationId, previousStatus: 'reconciliation', previousError: 'container-identity-unavailable' } }]);
    // The post is no longer frozen: the owner may now return or skip it like any approved post.
    await db.query('select marketing_decide_revision($1,$2,$3)', [revisionId, 'skipped', null]);
    expect((await revision(revisionId)).status).toBe('skipped');
  });
  it('re-queues a claim whose lease expired before any container existed, and reports a passed slot window', async () => {
    const { publicationId } = await stranded({ status: 'claimed', remote_container_id: null, error_code: 'container-retry', lease_until: new Date(Date.now() - 1000).toISOString(),
      scheduled_at: new Date(Date.now() - 20 * 60_000).toISOString() }, { status: 'approved' });
    expect((await requeue(publicationId)).rows[0]!.result).toBe('queued-window-passed');
    expect((await publication(publicationId)).status).toBe('queued');
  });
  it.each([
    ['a numeric container', { remote_container_id: '17890000000000001' }],
    ['a media ID', { remote_container_id: `intent:${sha}`, remote_media_id: '90001' }],
    ['a non-numeric media value', { remote_media_id: 'not-a-media-id' }],
    ['a permalink', { remote_url: 'https://www.instagram.com/p/offline-qa/' }],
    ['a recorded publish intent', { error_code: 'publish-intent' }],
  ] as const)('refuses a publication with %s and leaves it unchanged', async (_label, patch) => {
    const { revisionId, publicationId } = await stranded(patch);
    const before = { publication: await publication(publicationId), revision: await revision(revisionId) };
    await expect(requeue(publicationId)).rejects.toThrow('publication may be published');
    expect({ publication: await publication(publicationId), revision: await revision(revisionId) }).toEqual(before);
  });
  it('refuses a live claim, a finished publication, a revoked approval and another owner', async () => {
    const live = await stranded({ status: 'claimed', remote_container_id: null, error_code: 'container-retry', lease_until: new Date(Date.now() + 60_000).toISOString() }, { status: 'approved' });
    await expect(requeue(live.publicationId)).rejects.toThrow('publication not stranded');
    for (const status of ['queued', 'failed', 'published', 'cancelled']) {
      const row = await stranded({ status, remote_container_id: null });
      await expect(requeue(row.publicationId)).rejects.toThrow('publication not stranded');
    }
    const revoked = await stranded({}, { approved_hash: null });
    await expect(requeue(revoked.publicationId)).rejects.toThrow('approval changed');
    expect((await publication(revoked.publicationId)).status).toBe('reconciliation');
    const foreign = await stranded({}, { user: other });
    await expect(requeue(foreign.publicationId)).rejects.toThrow('publication unavailable');
  });
  it('is callable by the signed-in owner, never by anon', async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean }>(
      "select has_function_privilege('anon','marketing_requeue_publication(uuid)','EXECUTE') anon,has_function_privilege('authenticated','marketing_requeue_publication(uuid)','EXECUTE') authenticated");
    expect(rows[0]).toEqual({ anon: false, authenticated: true });
  });
  it('keeps a container retry claimed through the deployed checkpoint SQL, without this migration', async () => {
    const { publicationId } = await stranded({ status: 'claimed', remote_container_id: '300', error_code: 'container-pending', lease_until: new Date(Date.now() + 60_000).toISOString() }, { status: 'approved' });
    await db.query('select marketing_checkpoint_publication($1,$2,$3,$4,$5,$6)', [owner, publicationId, '300', 'container-pending', null, 'container-retry']);
    expect(await publication(publicationId)).toMatchObject({ status: 'claimed', remote_container_id: null, error_code: 'container-retry' });
  });
});
