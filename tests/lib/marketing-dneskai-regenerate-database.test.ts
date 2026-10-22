import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/** 20261022190000 (owner decision 8) over the job migrations, in isolated PGlite; every value is synthetic. */
let db: PGlite;
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const sha = 'a'.repeat(64);
const source = { sourceId: 'e'.repeat(64), sourceRevision: 'f'.repeat(64), contentHash: sha };
const content = (patch: Record<string, unknown> = {}) => ({ brand: 'dneskai', title: 'Syntetický příspěvek', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
  account: { id: 'account1', platform: 'instagram', handle: 'dneskai' }, sources: [source], ...patch });

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role;
  alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create table public.projects(id uuid primary key,user_id uuid not null); create table public.ai_links(id uuid primary key,user_id uuid not null);
  insert into auth.users values('${owner}'),('${other}');`);
  for (const file of ['20261013193104_marketing_control_surface', '20261013193105_marketing_durable_jobs']) await db.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
  // The render report column comes from 20261021122551; only the column matters to marketing_finish_job.
  await db.exec('alter table public.marketing_revisions add column render_report jsonb');
  await db.exec(readFileSync('supabase/migrations/20261021124706_marketing_job_render_report.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20261022190000_dneskai_regenerate_with_note.sql', 'utf8'));
  await db.query('select marketing_ingest_source($1,$2)', [owner, JSON.stringify({ brand: 'dneskai', ...source, observedAt: new Date().toISOString(), expiresAt: null, eligible: true })]);
}, 60_000);
afterAll(async () => { await db?.close(); });

async function revision(status: string, user = owner) {
  const id = randomUUID();
  await db.query(`insert into marketing_revisions(id,user_id,brand,revision,content_hash,ready,status) values($1,$2,'dneskai',$3,$4,true,$5)`, [id, user, JSON.stringify(content()), sha, status]);
  return id;
}
/** A running regeneration job without a calendar entry (so the calendar check passes) and its finish. */
async function finish(replaces: string | null) {
  const job = randomUUID(), fence = randomUUID(), next = randomUUID();
  const request = { schemaVersion: 'marketing-job/1', generation: { revisionId: next, source: { brand: 'dneskai' }, ownerNote: 'Kratší titulek.', ...(replaces ? { replacesRevisionId: replaces } : {}) } };
  await db.query("insert into marketing_jobs(id,user_id,idempotency_key,request_hash,request,status,fence,lease_until) values($1,$2,$3,$4,$5,'running',$6,now()+interval '2 minutes')",
    [job, owner, next, 'b'.repeat(64), JSON.stringify(request), fence]);
  const result = { revision: content({ title: 'Nový syntetický návrh' }), revisionHash: 'c'.repeat(64), slides: [] };
  const status = (await db.query<{ s: string }>('select marketing_finish_job($1,$2,$3,$4,null) s', [owner, job, fence, JSON.stringify(result)])).rows[0]!.s;
  return { status, next };
}
const row = async (id: string) => (await db.query<{ status: string; replaces_id: string | null; ready: boolean }>('select status,replaces_id,ready from marketing_revisions where id=$1', [id])).rows[0]!;

describe('marketing_finish_job with replacesRevisionId (owner decision 8)', () => {
  it('stays service-only', async () => {
    const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", ['marketing_finish_job(uuid,uuid,uuid,jsonb,text)']);
    expect(rows[0]).toEqual({ anon: false, authenticated: false, service: true });
  });

  it('supersedes a returned version and a version in review; the new draft is ready, in review and unapproved', async () => {
    for (const status of ['returned', 'review']) {
      const old = await revision(status);
      const { status: finished, next } = await finish(old);
      expect(finished).toBe('review');
      expect(await row(old)).toMatchObject({ status: 'superseded' });
      expect(await row(next)).toEqual({ status: 'review', replaces_id: old, ready: true });
      expect((await db.query<{ approved_hash: string | null }>('select approved_hash from marketing_revisions where id=$1', [next])).rows[0]!.approved_hash).toBeNull();
    }
  });

  it('leaves a version the owner approved meanwhile, and another owner’s revision, untouched', async () => {
    const approved = await revision('approved');
    let result = await finish(approved);
    expect(await row(approved)).toMatchObject({ status: 'approved' });
    expect(await row(result.next)).toMatchObject({ status: 'review', replaces_id: null });
    const foreign = await revision('returned', other);
    result = await finish(foreign);
    expect(await row(foreign)).toMatchObject({ status: 'returned' });
    expect(await row(result.next)).toMatchObject({ status: 'review', replaces_id: null });
  });

  it('behaves as before without the key', async () => {
    const old = await revision('returned');
    const { next } = await finish(null);
    expect(await row(old)).toMatchObject({ status: 'returned' });
    expect(await row(next)).toMatchObject({ status: 'review', replaces_id: null });
  });
});
