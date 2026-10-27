import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { ingestDneskaiAudioTrends, listDneskaiAudioTrends } from '@/lib/marketing/dneskai-audio-trends';
import { observationOwner as owner, observationAccount as account, observationNow as now } from '../helpers/dneskai-audio-observation-fixtures';
import type { MetaPublisherConfig } from '@/lib/marketing/publisher';
vi.mock('server-only', () => ({}));
const migration = '20261027044222_atomic_dneskai_audio_observations.sql', other = '99999999-9999-4999-8999-999999999999';
const config: MetaPublisherConfig = { enabled: false, apiVersion: 'v99.0', apiVersionVerifiedAt: '2026-10-20T00:00:00Z', loginMode: 'facebook', accessToken: 'TEST-ONLY-observation', tokenExpiresAt: '2099-01-01T00:00:00Z', scopes: [], approvedAssetHosts: [] };
let db: PGlite, service: SupabaseClient, privateOwner: SupabaseClient;
const item = (id = '1', title = 'Synthetic sound') => ({ audio_id: id, title, display_artist: null, audio_type: 'music', duration_ms: null, cover_artwork_thumbnail_url: null });
const args = (id = '1', observed = now.toISOString()) => ({ p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_enabled: false, p_day: '2026-10-23', p_observed_at: observed, p_items: [item(id)] });
async function seed(connection = db) { await connection.query("insert into marketing_accounts(id,user_id,brand,platform,remote_account_id,verified_at,enabled,handle) values($1,$2,'dneskai','instagram',$3,$4,false,'synthetic-observation')", [account.id, owner, account.remote_account_id, account.verified_at]); }
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: now }); await db.query('insert into auth.users(id) values($1)', [other]); await seed(); const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }, () => now); const client = (key: string) => createClient('https://example.supabase.co', key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } }); service = client('TEST-ONLY-service'); privateOwner = client('TEST-ONLY-owner'); }, 60000);
afterAll(async () => { await db?.close(); });
it('confirms account-bound observations through the full migration chain and actual SDK even with publishing paused', async () => { const fetcher = vi.fn(async (url: string | URL | Request) => Response.json({ data: new URL(String(url)).searchParams.get('audio_type') === 'music' ? [{ audio_id: '1', title: 'Synthetic sound' }] : [] })); expect(await ingestDneskaiAudioTrends(service, owner, { config, account, remoteAccountId: account.remote_account_id, today: '2026-10-23', now, fetcher })).toEqual({ status: 'done', stored: 1 }); const rows = await listDneskaiAudioTrends(service, owner, '2026-10-23'); expect(rows).toEqual([expect.objectContaining({ audioId: '1', daysSeen: 1, attachable: true, nicheCount: 0, tiktok: false })]); });
it('replays the same day without incrementing its history or rewriting its timestamp', async () => { const before = (await db.query('select * from marketing_audio_trends where audio_id=$1', ['1'])).rows; expect((await service.rpc('record_dneskai_audio_observations', args())).error).toBeNull(); expect((await db.query('select * from marketing_audio_trends where audio_id=$1', ['1'])).rows).toEqual(before); });
it('ignores an older same-day response after the newer confirmed observation', async () => { const id = '2'; expect((await service.rpc('record_dneskai_audio_observations', { ...args(id, '2026-10-23T12:00:00.000002Z'), p_items: [item(id, 'Newer')] })).error).toBeNull(); const old = await service.rpc('record_dneskai_audio_observations', args(id)); expect(old.error).toBeNull(); expect(old.data.rows[0]).toMatchObject({ outcome: 'superseded', title: 'Newer', daysSeen: 1, observedAt: '2026-10-23T12:00:00.000002+00:00' }); expect((await db.query('select title,days_seen from marketing_audio_trends where audio_id=$1', [id])).rows).toEqual([{ title: 'Newer', days_seen: 1 }]); });
it('rejects a previous-day commit after a newer day without regressing or double-counting it', async () => {
    const id = '3';
    await service.rpc('record_dneskai_audio_observations', args(id));
    await setDatabaseTime(db, '2026-10-24T12:00:00Z');
    try {
        await db.exec('set role service_role');
        await db.query('select public.record_dneskai_audio_observations($1,$2,$3,$4,false,$5,$6,$7::jsonb)', [owner, account.id, account.remote_account_id, account.verified_at, '2026-10-24', '2026-10-24T12:00:00Z', JSON.stringify([item(id, 'Next day')])]);
        await db.exec('reset role');
        await db.exec('set role service_role');
        const delayed = await db.query<{
            reply: {
                status: string;
            };
        }>('select public.record_dneskai_audio_observations($1,$2,$3,$4,false,$5,$6,$7::jsonb) reply', [owner, account.id, account.remote_account_id, account.verified_at, '2026-10-23', now.toISOString(), JSON.stringify([item(id)])]);
        expect(delayed.rows[0].reply.status).toBe('day-changed');
        expect((await db.query('select title,last_seen::text,days_seen from marketing_audio_trends where audio_id=$1', [id])).rows).toEqual([{ title: 'Next day', last_seen: '2026-10-24', days_seen: 2 }]);
    }
    finally {
        await db.exec('reset role');
        await setDatabaseTime(db, now);
    }
});
it('rejects equal-time conflicting metadata and rolls back an earlier item in the same batch', async () => { const id = '4'; await service.rpc('record_dneskai_audio_observations', args(id)); const reply = await service.rpc('record_dneskai_audio_observations', { ...args(id), p_items: [item('0004', 'Would insert'), item(id, 'Conflicting')] }); expect(reply.error?.code).toBe('40001'); expect((await db.query("select audio_id from marketing_audio_trends where audio_id='0004'")).rows).toEqual([]); });
it('preserves legacy owner history but excludes it from automatic attachment until observed', async () => { await db.query("insert into marketing_audio_trends(user_id,audio_id,title,audio_type,first_seen,last_seen,days_seen,niche_count,tiktok) values($1,'5','Legacy','music','2026-10-20','2026-10-22',2,99,true)", [owner]); expect((await listDneskaiAudioTrends(service, owner, '2026-10-23')).some(row => row.audioId === '5')).toBe(false); expect((await service.rpc('record_dneskai_audio_observations', args('5'))).error).toBeNull(); expect((await db.query("select first_seen::text,last_seen::text,days_seen,niche_count,tiktok from marketing_audio_trends where audio_id='5'")).rows).toEqual([{ first_seen: '2026-10-20', last_seen: '2026-10-23', days_seen: 3, niche_count: 99, tiktok: true }]); expect((await listDneskaiAudioTrends(service, owner, '2026-10-23')).find(row => row.audioId === '5')).toMatchObject({ nicheCount: 0, tiktok: false }); });
it('refuses raw legacy metadata overwrites while allowing independent legacy TikTok fields', async () => { expect((await service.from('marketing_audio_trends').update({ title: 'Old writer' }).eq('user_id', owner).eq('audio_id', '1')).error?.code).toBe('40001'); expect((await service.from('marketing_audio_trends').update({ tiktok: true, niche_count: 88 }).eq('user_id', owner).eq('audio_id', '1')).error).toBeNull(); });
it('invalidates account availability on microsecond re-verification, then accepts fresh proof', async () => {
    const verified = '2026-10-20T00:00:00.000002Z';
    await db.query('update marketing_accounts set verified_at=$1 where id=$2', [verified, account.id]);
    try {
        expect(await listDneskaiAudioTrends(service, owner, '2026-10-23')).toEqual([]);
        const stale = await service.rpc('record_dneskai_audio_observations', args('6'));
        expect(stale.data.status).toBe('account-changed');
        const fresh = await service.rpc('record_dneskai_audio_observations', { ...args('6', '2026-10-23T12:00:00.000003Z'), p_verified_at: verified });
        expect(fresh.error).toBeNull();
        expect((await listDneskaiAudioTrends(service, owner, '2026-10-23')).map(row => row.audioId)).toEqual(['6']);
    }
    finally {
        await db.query('update marketing_accounts set verified_at=$1 where id=$2', [account.verified_at, account.id]);
    }
});
it('invalidates account switches and refuses foreign owner/context or publication-state changes', async () => {
    for (const patch of [{ p_owner: other }, { p_account: crypto.randomUUID() }, { p_remote: '9' }, { p_enabled: true }, { p_verified_at: '2026-10-20T00:00:00.000002Z' }]) {
        const reply = await service.rpc('record_dneskai_audio_observations', { ...args('7'), ...patch });
        expect(reply.error).toBeNull();
        expect(reply.data.status).toBe('account-changed');
    }
    await db.query("update marketing_accounts set remote_account_id='9' where id=$1", [account.id]);
    try {
        expect(await listDneskaiAudioTrends(service, owner, '2026-10-23')).toEqual([]);
    }
    finally {
        await db.query('update marketing_accounts set remote_account_id=$1 where id=$2', [account.remote_account_id, account.id]);
    }
});
it.each([{ p_observed_at: 'infinity' }, { p_observed_at: '2026-10-23T12:05:01Z' }, { p_day: '2026-10-24' }, { p_verified_at: '2026-10-23T12:00:00.000001Z' }, { p_items: [item(), item()] }, { p_items: Array.from({ length: 51 }, (_, index) => item(String(index))) }, { p_items: [{ ...item(), future_private: 'Excluded' }] }, { p_items: [{ ...item(), audio_id: 1 }] }, { p_items: [{ ...item(), duration_ms: 0.5 }] }, { p_items: [{ ...item(), title: ' ' }] }])('refuses invalid or oversized service observations %j', async (patch) => { const reply = await service.rpc('record_dneskai_audio_observations', { ...args('8'), ...patch }); expect(reply.error).not.toBeNull(); });
it('keeps new RPCs service-only and preserves owner-only table reads', async () => {
    expect((await privateOwner.rpc('record_dneskai_audio_observations', args())).error).not.toBeNull();
    expect((await privateOwner.rpc('read_dneskai_audio_observations', { p_owner: owner, p_today: '2026-10-23' })).error).not.toBeNull();
    for (const fn of ['record_dneskai_audio_observations(uuid,uuid,text,timestamptz,boolean,date,timestamptz,jsonb)', 'read_dneskai_audio_observations(uuid,date)']) {
        expect((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed", ['public.' + fn])).rows).toEqual([{ allowed: false }]);
    }
    const owned = await privateOwner.from('marketing_audio_trends').select('user_id');
    expect(owned.data?.length).toBeGreaterThan(0);
    expect(owned.data?.every(row => row.user_id === owner)).toBe(true);
});
it('projects only positive fields, with a deterministic bounded fifty-sound policy', async () => { await db.exec('alter table marketing_audio_trends add column future_private text default \'Synthetic private future\''); const reply = await service.rpc('read_dneskai_audio_observations', { p_owner: owner, p_today: '2026-10-23' }); expect(reply.error).toBeNull(); expect(JSON.stringify(reply.data)).not.toContain('future_private'); expect(JSON.stringify(reply.data)).not.toContain('niche_count'); expect(Object.keys(reply.data.rows[0]).sort()).toEqual(['user_id', 'audio_id', 'title', 'display_artist', 'audio_type', 'duration_ms', 'cover_artwork_thumbnail_url', 'days_seen', 'tiktok', 'last_seen', 'observed_account_id', 'observed_remote_account_id', 'observed_verified_at', 'observed_at'].sort()); });
it('preserves populated history and restores schema on transactional migration rollback', async () => {
    const upgrade = await createMigratedDatabase({ owner, instant: now, beforeMigration: migration });
    try {
        await seed(upgrade);
        await upgrade.query("insert into marketing_audio_trends(user_id,audio_id,title,audio_type,first_seen,last_seen) values($1,'9','Preserved','music','2026-10-22','2026-10-23')", [owner]);
        const before = (await upgrade.query('select * from marketing_audio_trends')).rows;
        await upgrade.exec('begin;' + readFileSync(`supabase/migrations/${migration}`, 'utf8'));
        const after = (await upgrade.query<Record<string, unknown>>('select * from marketing_audio_trends')).rows.map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('observed_'))));
        expect(after).toEqual(before);
        await upgrade.exec('rollback');
        expect((await upgrade.query("select to_regprocedure('public.read_dneskai_audio_observations(uuid,date)') present")).rows).toEqual([{ present: null }]);
        expect((await upgrade.query('select * from marketing_audio_trends')).rows).toEqual(before);
    }
    finally {
        await upgrade.close();
    }
}, 60000);
it('rolls back a batch when a trigger suppresses or changes its persisted observation', async () => {
    for (const mode of ['suppress', 'alter']) {
        await db.exec(`create function public.synthetic_audio_observation_refusal() returns trigger language plpgsql as $$begin if new.audio_id='0101' then ${mode === 'suppress' ? 'return null;' : "new.title:='Altered by fixture';"} end if;return new;end$$;create trigger zz_synthetic_audio_refusal before insert on marketing_audio_trends for each row execute function public.synthetic_audio_observation_refusal();`);
        try {
            const reply = await service.rpc('record_dneskai_audio_observations', { ...args(), p_items: [item('0100'), item('0101')] });
            expect(reply.error?.code).toBe('40001');
            expect((await db.query("select audio_id from marketing_audio_trends where audio_id in ('0100','0101')")).rows).toEqual([]);
        }
        finally {
            await db.exec('drop trigger zz_synthetic_audio_refusal on marketing_audio_trends;drop function public.synthetic_audio_observation_refusal();');
        }
    }
});
it('caps the real recommendation projection at fifty with deterministic ties and excludes old proof', async () => {
    const items = Array.from({ length: 60 }, (_, index) => item(String(1000 + index)));
    for (const batch of [items.slice(0, 50), items.slice(50)])
        expect((await service.rpc('record_dneskai_audio_observations', { ...args(), p_items: batch })).error).toBeNull();
    const reply = await service.rpc('read_dneskai_audio_observations', { p_owner: owner, p_today: '2026-10-23' });
    expect(reply.error).toBeNull();
    expect(reply.data.rows).toHaveLength(50);
    const ones = reply.data.rows.filter((row: {
        days_seen: number;
    }) => row.days_seen === 1).map((row: {
        audio_id: string;
    }) => row.audio_id);
    expect(ones).toEqual([...ones].sort());
    expect(await listDneskaiAudioTrends(service, owner, '2026-10-26')).toEqual([]);
});
