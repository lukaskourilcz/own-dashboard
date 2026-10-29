import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const owner = '11111111-1111-4111-8111-111111111111', now = '2026-10-25T12:00:00Z', early = '2026-10-25T11:00:00Z';
const row = (id = 'one', title = 'React frontend engineer') => ({ external_id: id, title, company: null, url: `https://thehub.io/jobs/${id}`, location: 'Oslo', role: 'frontend', remote: true, salary: null, tags: ['React'], seniority: null, description: 'React TypeScript frontend', posted_at: null });
let db: PGlite, service: SupabaseClient, authenticated: SupabaseClient;
beforeAll(async () => {
 db = await createMigratedDatabase({ owner, instant: now }); const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }, () => new Date(now));
 const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input: RequestInfo | URL, init?: RequestInit) => emulator.fetch(input, init) } }; service = createClient('https://example.supabase.co', 'TEST-ONLY-service', options); authenticated = createClient('https://example.supabase.co', 'TEST-ONLY-owner', options);
}, 60_000);
beforeEach(async () => { await db.exec('truncate public.job_listings,career_private.source_snapshots cascade'); }); afterAll(async () => { await db?.close(); });
async function apply(rows: unknown[] = [row()], at = now, source = 'remoteok', complete = false) {
 const result = await service.rpc('career_apply_source_snapshot', { p_source: source, p_observed_at: at, p_rows: rows, p_complete: complete }); if (result.error) throw result.error; return result.data;
}
it('returns actual insert/update actions and preserves first-seen history', async () => {
 expect(await apply([row(), row('two')], early)).toMatchObject({ status: 'applied', received: 2, inserted: 2, refreshed: 0, pruned: 0 });
 const before = (await db.query('select first_seen_at from job_listings where external_id=$1', ['one'])).rows[0];
 expect(await apply([row('one', 'Updated React frontend'), row('three')])).toMatchObject({ status: 'applied', inserted: 1, refreshed: 1, pruned: 0 });
 expect((await db.query('select first_seen_at from job_listings where external_id=$1', ['one'])).rows[0]).toEqual(before);
});
it('deduplicates the same ordered snapshot and refuses a conflicting same-time payload', async () => {
 await apply([row(), row('two')]); expect(await apply([row('two'), row()])).toMatchObject({ status: 'duplicate', inserted: 0, refreshed: 0 }); expect(await apply([row('one', 'Different React version')])).toMatchObject({ status: 'conflict', inserted: 0, refreshed: 0 }); expect((await db.query('select title from job_listings where external_id=$1', ['one'])).rows[0]).toEqual({ title: row().title });
});
it('retains the latest watermark even after all of its listing rows are removed', async () => {
 await apply(); await db.query('delete from job_listings'); expect(await apply([row('new')], early)).toMatchObject({ status: 'stale', inserted: 0, refreshed: 0 }); expect((await db.query('select count(*)::int n from job_listings')).rows[0]).toEqual({ n: 0 });
});
it('seeds admission from existing source history without rewriting a later or equal observation', async () => {
 await db.query(`insert into job_listings(source,external_id,title,url,location,role,remote,tags,last_seen_at) values('remoteok','one','Latest React title','https://thehub.io/jobs/one','Oslo','frontend',true,array['React'],$1)`, [now]);
 expect(await apply([row()], early)).toMatchObject({ status: 'stale' }); expect(await apply()).toMatchObject({ status: 'applied', inserted: 0, refreshed: 0 }); expect((await db.query('select title from job_listings')).rows[0]).toEqual({ title: 'Latest React title' });
});
it('allows absence proof only for a nonempty complete curated source', async () => {
 await apply([row(), row('two')], early, 'curated', true); expect(await apply([row()], now, 'curated', true)).toMatchObject({ pruned: 1, refreshed: 1 }); expect((await db.query('select external_id from job_listings')).rows).toEqual([{ external_id: 'one' }]);
});
it.each([true, false])('retains listings after an empty result (complete=%s)', async complete => {
 await apply([row()], early, 'curated', true); expect(await apply([], now, 'curated', complete)).toMatchObject({ pruned: 0 }); expect((await db.query('select count(*)::int n from job_listings')).rows[0]).toEqual({ n: 1 });
});
it('keeps omitted discovery rows and unrelated sources', async () => {
 await apply([row(), row('two')], early); await apply([row('foreign')], early, 'remotive'); expect(await apply([row()])).toMatchObject({ pruned: 0 }); expect((await db.query('select count(*)::int n from job_listings')).rows[0]).toEqual({ n: 3 });
});
it.each(['wrong-complete', 'duplicate', 'role', 'extra', 'missing', 'oversized', 'future', 'expired', 'source'] as const)('refuses an invalid atomic batch without partial rows or watermarks: %s', async kind => {
 const args = { p_source: kind === 'source' ? '../invalid' : 'remoteok', p_observed_at: kind === 'future' ? '2026-10-25T12:01:00.001Z' : kind === 'expired' ? '2026-10-24T11:59:59Z' : now, p_rows: kind === 'duplicate' ? [row(), row()] : kind === 'role' ? [row(), { ...row('two'), role: 'invalid' }] : kind === 'extra' ? [{ ...row(), unexpected: true }] : kind === 'missing' ? [{ external_id: 'one' }] : kind === 'oversized' ? Array.from({ length: 1001 }, (_, index) => row(String(index))) : [row()], p_complete: kind === 'wrong-complete' };
 expect((await service.rpc('career_apply_source_snapshot', args)).error).not.toBeNull(); expect((await db.query('select count(*)::int n from job_listings')).rows[0]).toEqual({ n: 0 }); expect((await db.query('select count(*)::int n from career_private.source_snapshots')).rows[0]).toEqual({ n: 0 });
});
it('bounds distributed observation-clock skew without widening provider freshness rules', async () => { expect(await apply([row()], '2026-10-25T12:00:30Z')).toMatchObject({ status: 'applied', inserted: 1 }); });
it('rejects authenticated clients before they can invoke a service mutation or inspect watermark state', async () => {
 const result = await authenticated.rpc('career_apply_source_snapshot', { p_source: 'remoteok', p_observed_at: now, p_rows: [row()], p_complete: false }); expect(result.error).not.toBeNull(); expect(result.data).toBeNull();
 const privilege = await db.query<{ execute: boolean; table_read: boolean; invoker: boolean }>(`select has_function_privilege('authenticated','public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean)','execute') as execute,has_table_privilege('authenticated','career_private.source_snapshots','select') as table_read,not prosecdef as invoker from pg_proc where oid='public.career_apply_source_snapshot(text,timestamptz,jsonb,boolean)'::regprocedure`); expect(privilege.rows[0]).toEqual({ execute: false, table_read: false, invoker: true });
});
it('deletes only the exact observed listing version and URL', async () => {
 await apply([row()], early); const proof = (await db.query('select id,source,url,last_seen_at from job_listings')).rows;
 await apply([row('one', 'Refreshed React title')]); expect((await service.rpc('career_delete_listing_versions', { p_rows: proof })).data).toBe(0);
 const current = (await db.query('select id,source,url,last_seen_at from job_listings')).rows; expect((await service.rpc('career_delete_listing_versions', { p_rows: current })).data).toBe(1);
});
it('keeps a repointed listing even if an external maintenance update left its timestamp unchanged', async () => {
 await apply(); const proof = (await db.query('select id,source,url,last_seen_at from job_listings')).rows; await db.query(`update job_listings set url='https://thehub.io/jobs/new-url'`); expect((await service.rpc('career_delete_listing_versions', { p_rows: proof })).data).toBe(0);
});
it('returns the entire 1,201-row retention count beyond the REST cap and preserves current/other-source rows', async () => {
 await db.exec(`insert into job_listings(source,external_id,title,url,role,last_seen_at) select 'remoteok',n::text,'React frontend','https://thehub.io/jobs/'||n,'frontend','2026-08-01'::timestamptz from generate_series(1,1201)n; insert into job_listings(source,external_id,title,url,role,last_seen_at) values('remotive','other','React','https://thehub.io/jobs/other','frontend','2026-08-01');`); await apply([row('current')]);
 const result = await service.rpc('career_prune_stale_listings', { p_sources: ['remoteok'] }); expect(result.error).toBeNull(); expect(result.data).toBe(1201); expect((await db.query('select source,external_id from job_listings order by source')).rows).toEqual([{ source: 'remoteok', external_id: 'current' }, { source: 'remotive', external_id: 'other' }]);
});

it.each(['absence', 'version', 'retention'] as const)('preserves permanent owner tombstones through %s cleanup', async kind => {
 await apply([row()], early, 'curated'); const saved = (await db.query<{ id: string }>('select id from job_listings')).rows[0]; await db.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')", [owner, saved.id]);
 if (kind === 'absence') expect(await apply([row('two')], now, 'curated', true)).toMatchObject({ pruned: 0 });
 if (kind === 'version') { const proof = (await db.query('select id,source,url,last_seen_at from job_listings')).rows; expect((await service.rpc('career_delete_listing_versions', { p_rows: proof })).data).toBe(0); }
 if (kind === 'retention') { await db.query("update job_listings set last_seen_at='2026-08-01'"); expect((await service.rpc('career_prune_stale_listings', { p_sources: ['curated'] })).data).toBe(0); }
 expect((await db.query('select user_id,listing_id,state from job_user_state')).rows).toEqual([{ user_id: owner, listing_id: saved.id, state: 'deleted' }]);
});

const migration = '20261025204635_career_monotonic_source_snapshots.sql';
it.each(['upgrade', 'rollback'] as const)('preserves existing listings and private owner state through migration %s', async mode => {
 const legacy = await createMigratedDatabase({ owner, instant: now, beforeMigration: migration });
 try {
  await legacy.query("insert into job_listings(source,external_id,title,url,role) values('remoteok','existing','React frontend','https://thehub.io/jobs/existing','frontend')"); const id = (await legacy.query<{ id: string }>('select id from job_listings')).rows[0].id;
  await legacy.query("insert into job_user_state(user_id,listing_id,state) values($1,$2,'deleted')", [owner, id]); const before = (await legacy.query('select row_to_json(j) data from job_listings j')).rows;
  const sql = readFileSync(`supabase/migrations/${migration}`, 'utf8');
  if (mode === 'upgrade') await legacy.exec(sql);
  else await expect(legacy.transaction(async tx => { await tx.exec(sql); throw Error('synthetic-rollback'); })).rejects.toThrow('synthetic-rollback');
  expect((await legacy.query('select row_to_json(j) data from job_listings j')).rows).toEqual(before); expect((await legacy.query('select listing_id,state from job_user_state')).rows).toEqual([{ listing_id: id, state: 'deleted' }]);
  expect((await legacy.query<{ found: boolean }>("select to_regclass('career_private.source_snapshots') is not null as found")).rows[0].found).toBe(mode === 'upgrade');
 } finally { await legacy.close(); }
}, 60_000);
