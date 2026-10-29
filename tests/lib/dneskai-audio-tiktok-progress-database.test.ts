import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createMigratedDatabase, setDatabaseTime } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { readDneskaiTikTokProgress, completeDneskaiTikTokRun, type DneskaiTikTokProgress, type DneskaiTikTokTerminalRun } from '@/lib/marketing/dneskai-tiktok-progress';
import { listDneskaiAudioTrends } from '@/lib/marketing/dneskai-audio-trends';
import { observationOwner as owner, observationAccount as account } from '../helpers/dneskai-audio-observation-fixtures';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-24T12:00:00Z'), migration = '20261027050940_dated_dneskai_tiktok_receipts.sql', other = '99999999-9999-4999-8999-999999999999';
let db: PGlite, service: SupabaseClient, privateOwner: SupabaseClient;
const signal = () => new AbortController().signal;
async function seed(patch: {
    reserved?: string;
    settled?: boolean;
    cost?: number;
    actor?: string;
    reservedUsd?: number;
} = {}, connection = db) {
    const id = crypto.randomUUID(), ref = `tiktok:run_${id.replaceAll('-', '')}:dataset_${id.replaceAll('-', '')}`, reserved = patch.reserved ?? '2026-10-23T12:00:00.000001Z', settled = patch.settled ?? false, cost = settled ? (patch.cost ?? 0.09) : null, reservedUsd = patch.reservedUsd ?? 0.1;
    await connection.query('insert into marketing_private.dneskai_topic_spend(id,user_id,kind,ref,reserved_usd,reserved_at,cost_usd,settled_at) values($1,$2,\'tiktok\',$3,$4,$5,$6,$7)', [id, patch.actor ?? owner, ref, reservedUsd, reserved, cost, settled ? '2026-10-23T13:00:00Z' : null]);
    const row: DneskaiTikTokProgress = { id, ref, reserved_at: reserved, settled, cost_usd: cost, reserved_usd: reservedUsd, processed: false };
    const run: DneskaiTikTokTerminalRun = {
        id: ref.split(':')[1], actorId: 'sDvA9jM4WRTDX4Syr', datasetId: ref.split(':')[2], startedAt: reserved, finishedAt: reserved.replace('12:00:00.000001', '12:01:00.000001'), status: 'SUCCEEDED', usageUsd: 0.076
    };
    return { row, run };
}
const item = (audioId = BigInt('0x' + crypto.randomUUID().replaceAll('-', '')).toString()) => ({ audioId, title: 'Synthetic matched sound', artist: 'Synthetic artist' });
const args = (f: Awaited<ReturnType<typeof seed>>, matches = [item()]) => ({
    p_owner: owner, p_account: account.id, p_remote: account.remote_account_id, p_verified_at: account.verified_at, p_enabled: false, p_spend: f.row.id, p_ref: f.row.ref, p_reserved_at: f.row.reserved_at, p_day: '2026-10-24', p_observed_at: now.toISOString(), p_run: f.run, p_matches: matches
});
async function accountSeed(connection = db) {
    await connection.query("insert into marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram',$3,'synthetic',$4,false)", [account.id, owner, account.remote_account_id, account.verified_at]);
}
beforeAll(async () => {
    db = await createMigratedDatabase({ owner, instant: now });
    await db.query('insert into auth.users(id) values($1)', [other]);
    await accountSeed();
    const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }, () => now);
    const client = (key: string) => createClient('https://example.supabase.co', key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
    service = client('TEST-ONLY-service');
    privateOwner = client('TEST-ONLY-owner');
}, 60000);
afterAll(async () => {
    await db?.close();
});
it('completes dated matches and cost atomically through the full migration chain and actual SDK', async () => {
    const f = await seed(), matched = item('910001');
    expect(await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [matched], now, signal: signal() })).toBe(1);
    const rows = await listDneskaiAudioTrends(service, owner, '2026-10-24');
    expect(rows.find(row => row.audioId === matched.audioId)).toMatchObject({ title: matched.title, tiktok: true, daysSeen: 0, attachable: true });
    const read = await readDneskaiTikTokProgress(service, owner, now, signal());
    expect(read.find(row => row.id === f.row.id)).toMatchObject({ settled: true, processed: true, cost_usd: 0.076 });
});
it('replays only the exact completion without rewriting records and refuses conflicting intent', async () => {
    const f = await seed(), request = args(f, [item('910002')]);
    const first = await service.rpc('complete_dneskai_tiktok_run', request);
    expect(first.error).toBeNull();
    const before = (await db.query('select * from marketing_audio_trends where audio_id=$1', ['910002'])).rows;
    expect((await service.rpc('complete_dneskai_tiktok_run', request)).data).toEqual(first.data);
    expect((await db.query('select * from marketing_audio_trends where audio_id=$1', ['910002'])).rows).toEqual(before);
    expect((await service.rpc('complete_dneskai_tiktok_run', { ...request, p_matches: [item('910003')] })).error?.code).toBe('40001');
});
it('keeps the chart source day when it is read later and expires it instead of refreshing an old flag', async () => {
    const f = await seed(), matched = item('910004');
    await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [matched], now, signal: signal() });
    expect((await db.query<{
        day: string;
    }>("select tiktok_seen_on::text as source_day from marketing_audio_trends where audio_id='910004'")).rows).toEqual([{ source_day: '2026-10-23' }]);
    expect((await listDneskaiAudioTrends(service, owner, '2026-10-25')).some(row => row.audioId === matched.audioId)).toBe(false);
});
it('preserves confirmed Meta metadata/history while adding independent dated TikTok evidence', async () => {
    const f = await seed(), matched = item('910005');
    await db.query("insert into marketing_audio_trends(user_id,audio_id,title,display_artist,audio_type,duration_ms,first_seen,last_seen,days_seen,observed_account_id,observed_remote_account_id,observed_verified_at,observed_at) values($1,'910005','Confirmed Meta','Meta artist','music',31000,'2026-10-20','2026-10-24',4,$2,$3,$4,'2026-10-24T11:00:00Z')", [owner, account.id, account.remote_account_id, account.verified_at]);
    const before = (await db.query("select title,display_artist,duration_ms,first_seen,last_seen,days_seen,observed_at,updated_at from marketing_audio_trends where audio_id='910005'")).rows;
    await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [matched], now, signal: signal() });
    expect((await db.query("select title,display_artist,duration_ms,first_seen,last_seen,days_seen,observed_at,updated_at from marketing_audio_trends where audio_id='910005'")).rows).toEqual(before);
    expect((await listDneskaiAudioTrends(service, owner, '2026-10-24')).find(row => row.audioId === matched.audioId)).toMatchObject({ title: 'Confirmed Meta', daysSeen: 4, durationMs: 31000, tiktok: true });
});
it('never guesses legacy flags or historical settlements into new proof', async () => {
    const f = await seed({ settled: true, cost: 0.09 });
    await db.query("insert into marketing_audio_trends(user_id,audio_id,title,audio_type,first_seen,last_seen,tiktok) values($1,'910006','Legacy','music','2026-10-23','2026-10-24',true)", [owner]);
    expect((await listDneskaiAudioTrends(service, owner, '2026-10-24')).some(row => row.audioId === '910006')).toBe(false);
    expect((await readDneskaiTikTokProgress(service, owner, now, signal())).find(row => row.id === f.row.id)).toMatchObject({ settled: true, processed: false, cost_usd: 0.09 });
    await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [item('910006')], now, signal: signal() });
    expect((await readDneskaiTikTokProgress(service, owner, now, signal())).find(row => row.id === f.row.id)).toMatchObject({ cost_usd: 0.09, processed: true });
});
it('preserves unknown-cost reservations in full and conservatively rounds tiny known costs', async () => {
    const unknown = await seed();
    unknown.run.usageUsd = null;
    await expect(completeDneskaiTikTokRun(service, owner, { account, ...unknown, matches: [], now, signal: signal() })).rejects.toThrow('tiktok-completion-unavailable');
    expect((await readDneskaiTikTokProgress(service, owner, now, signal())).find(row => row.id === unknown.row.id)).toMatchObject({ settled: false, processed: false, cost_usd: null, reserved_usd: 0.1 });
    for (const [usage, expected] of [[0.000001, 0.0001], [0.01505, 0.0151], [0, 0]] as const) {
        const f = await seed();
        f.run.usageUsd = usage;
        expect(await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [], now, signal: signal() })).toBe(0);
        expect((await readDneskaiTikTokProgress(service, owner, now, signal())).find(row => row.id === f.row.id)?.cost_usd).toBe(expected);
    }
});
it('settles an older chart without accepting fresh signal metadata', async () => {
    const f = await seed({ reserved: '2026-10-22T12:00:00.000001Z' });
    expect((await service.rpc('complete_dneskai_tiktok_run', args(f, [item('910007')]))).error?.code).toBe('22023');
    expect(await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [], now, signal: signal() })).toBe(0);
    expect((await db.query("select audio_id from marketing_audio_trends where audio_id='910007'")).rows).toEqual([]);
});
it.each(['suppress', 'alter'])('rolls the entire match batch and cost back when final progress is %s', async (mode) => {
    const f = await seed();
    await db.exec(`create function marketing_private.synthetic_tiktok_refusal() returns trigger language plpgsql as $$begin if new.id='${f.row.id}' and new.tiktok_receipt is not null then ${mode === 'suppress' ? 'return null;' : "new.cost_usd:=0.01;"} end if;return new;end$$;create trigger zz_synthetic_tiktok_refusal before update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.synthetic_tiktok_refusal();`);
    try {
        expect((await service.rpc('complete_dneskai_tiktok_run', args(f, [item('910008')]))).error?.code).toBe('40001');
        expect((await db.query("select audio_id from marketing_audio_trends where audio_id='910008'")).rows).toEqual([]);
        expect((await db.query('select settled_at,tiktok_receipt from marketing_private.dneskai_topic_spend where id=$1', [f.row.id])).rows).toEqual([{ settled_at: null, tiktok_receipt: null }]);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_tiktok_refusal on marketing_private.dneskai_topic_spend;drop function marketing_private.synthetic_tiktok_refusal();');
    }
});
it('refuses account re-verification, foreign/missing reservations and changed bindings', async () => {
    const f = await seed(), foreign = await seed({ actor: other });
    for (const patch of [{ p_verified_at: '2026-10-20T00:00:00.000002Z' }, { p_enabled: true }, { p_remote: '9' }, { p_spend: foreign.row.id }, { p_spend: crypto.randomUUID() }, { p_reserved_at: '2026-10-23T12:00:00.000002Z' }, { p_ref: 'tiktok:other:other' }])
        expect((await service.rpc('complete_dneskai_tiktok_run', { ...args(f), ...patch })).error).not.toBeNull();
    expect((await db.query('select settled_at from marketing_private.dneskai_topic_spend where id=$1', [f.row.id])).rows).toEqual([{ settled_at: null }]);
});
it('hides dated availability immediately after an account switch or microsecond verification change', async () => {
    const f = await seed();
    await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [item('910009')], now, signal: signal() });
    await db.query('update marketing_accounts set verified_at=$1 where id=$2', ['2026-10-20T00:00:00.000002Z', account.id]);
    try {
        expect(await listDneskaiAudioTrends(service, owner, '2026-10-24')).toEqual([]);
    }
    finally {
        await db.query('update marketing_accounts set verified_at=$1 where id=$2', [account.verified_at, account.id]);
    }
});
it('makes completed progress immutable', async () => {
    const f = await seed();
    await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [], now, signal: signal() });
    await expect(db.query('update marketing_private.dneskai_topic_spend set tiktok_receipt=null,tiktok_fingerprint=null where id=$1', [f.row.id])).rejects.toThrow('TikTok completion immutable');
});
it('exposes complete progress beyond five rows and refuses the 1,001st record', async () => {
    const existing = (await db.query<{
        count: number;
    }>("select count(*)::int count from marketing_private.dneskai_topic_spend where user_id=$1 and kind='tiktok' and reserved_at>'2026-10-21T12:00:00Z'", [owner])).rows[0].count;
    await db.query("insert into marketing_private.dneskai_topic_spend(user_id,kind,ref,reserved_usd,reserved_at) select $1,'tiktok','tiktok:pending',0.1,'2026-10-23T12:00:00Z' from generate_series(1,$2::integer)", [owner, 1000 - existing]);
    expect(await readDneskaiTikTokProgress(service, owner, now, signal())).toHaveLength(1000);
    const extra = await seed();
    await expect(readDneskaiTikTokProgress(service, owner, now, signal())).rejects.toThrow('tiktok-budget-unavailable');
    await db.query('delete from marketing_private.dneskai_topic_spend where id=$1', [extra.row.id]);
    await db.query("delete from marketing_private.dneskai_topic_spend where user_id=$1 and ref='tiktok:pending' and reserved_at='2026-10-23T12:00:00Z'", [owner]);
}, 60000);
it('keeps completion/progress service-only and all future private fields out of receipts', async () => {
    const f = await seed();
    expect((await privateOwner.rpc('complete_dneskai_tiktok_run', args(f, []))).error).not.toBeNull();
    expect((await privateOwner.rpc('read_dneskai_tiktok_progress', { p_owner: owner, p_until: now.toISOString() })).error).not.toBeNull();
    await db.exec("alter table marketing_private.dneskai_topic_spend add column future_private text default 'Synthetic excluded detail'");
    const reply = await service.rpc('read_dneskai_tiktok_progress', { p_owner: owner, p_until: now.toISOString() });
    expect(reply.error).toBeNull();
    expect(JSON.stringify(reply.data)).not.toContain('future_private');
    expect(JSON.stringify(reply.data)).not.toContain('tiktok_fingerprint');
});
it('preserves populated audio/spend history and restores schema on upgrade rollback', async () => {
    const upgrade = await createMigratedDatabase({ owner, instant: now, beforeMigration: migration });
    try {
        await accountSeed(upgrade);
        await seed({}, upgrade);
        await upgrade.query("insert into marketing_audio_trends(user_id,audio_id,title,audio_type,first_seen,last_seen,tiktok) values($1,'919999','Preserved legacy','music','2026-10-22','2026-10-23',true)",[owner]);
        const audioBefore=(await upgrade.query('select user_id,audio_id,title,first_seen,last_seen,days_seen,niche_count,tiktok from marketing_audio_trends')).rows;
        const before = (await upgrade.query('select id,ref,reserved_at,cost_usd,settled_at from marketing_private.dneskai_topic_spend')).rows;
        await upgrade.exec('begin;' + readFileSync(`supabase/migrations/${migration}`, 'utf8'));
        expect((await upgrade.query('select id,ref,reserved_at,cost_usd,settled_at from marketing_private.dneskai_topic_spend')).rows).toEqual(before);
        expect((await upgrade.query('select user_id,audio_id,title,first_seen,last_seen,days_seen,niche_count,tiktok from marketing_audio_trends')).rows).toEqual(audioBefore);
        await upgrade.exec('rollback');
        expect((await upgrade.query('select user_id,audio_id,title,first_seen,last_seen,days_seen,niche_count,tiktok from marketing_audio_trends')).rows).toEqual(audioBefore);
        expect((await upgrade.query("select to_regprocedure('public.read_dneskai_tiktok_progress(uuid,timestamptz)') present")).rows).toEqual([{ present: null }]);
        expect((await upgrade.query('select id,ref,reserved_at,cost_usd,settled_at from marketing_private.dneskai_topic_spend')).rows).toEqual(before);
    }
    finally {
        await upgrade.close();
    }
}, 60000);
it('uses elapsed 72 hours across Prague DST rather than a session-dependent three calendar days', async () => {
    const cutoff = new Date('2026-10-27T12:00:00Z'), old = await seed({ actor: other, reserved: '2026-10-24T11:59:59.999999Z' }), included = await seed({ actor: other, reserved: '2026-10-24T12:00:00.000001Z' });
    await setDatabaseTime(db, cutoff);
    await db.exec("set timezone='Europe/Prague';set role service_role");
    try {
        const reply = await db.query<{
            reply: {
                rows: Array<{
                    id: string;
                }>;
            };
        }>('select public.read_dneskai_tiktok_progress($1,$2) reply', [other, cutoff.toISOString()]);
        const ids = reply.rows[0].reply.rows.map(row => row.id);
        expect(ids).toContain(included.row.id);
        expect(ids).not.toContain(old.row.id);
    }
    finally {
        await db.exec("reset role;set timezone='UTC'");
        await setDatabaseTime(db, now);
    }
});
it('does not replace a newer chart observation when an older captured pass completes later', async () => {
    const first = await seed(), late = await seed(), matched = item('910010');
    expect(await completeDneskaiTikTokRun(service, owner, { account, ...first, matches: [matched], now, signal: signal() })).toBe(1);
    expect(await completeDneskaiTikTokRun(service, owner, { account, ...late, matches: [{ ...matched, title: 'Older title' }], now: new Date(now.getTime() - 60000), signal: signal() })).toBe(0);
    expect((await db.query("select tiktok_title,tiktok_run_id from marketing_audio_trends where audio_id='910010'")).rows).toEqual([{ tiktok_title: matched.title, tiktok_run_id: first.row.id }]);
});
it.each([{ actorId: 'different' }, { id: 'different' }, { datasetId: 'different' }, { status: 'RUNNING' }, { finishedAt: '2026-10-24T12:00:00Z' }, { startedAt: '2026-10-22T12:00:00Z' }, { usageUsd: -1 }, { usageUsd: 11 }, { finishedAt: 'infinity' }])('refuses invalid or preliminary terminal run proof: %j', async (patch) => {
    const f = await seed();
    expect((await service.rpc('complete_dneskai_tiktok_run', { ...args(f), p_run: { ...f.run, ...patch } })).error).not.toBeNull();
    expect((await db.query('select settled_at from marketing_private.dneskai_topic_spend where id=$1', [f.row.id])).rows).toEqual([{ settled_at: null }]);
});
it.each([{ label: 'duplicate', matches: [item('910011'), item('910011')] }, { label: 'oversized', matches: Array.from({ length: 26 }, (_, i) => item(String(920000 + i))) }, { label: 'blank title', matches: [{ ...item('910012'), title: ' ' }] }, { label: 'future field', matches: [{ ...item('910013'), future_private: 'Excluded' }] }])('refuses $label match batches', async ({ matches }) => {
    const f = await seed();
    expect((await service.rpc('complete_dneskai_tiktok_run', args(f, matches))).error).not.toBeNull();
});
it('rolls back proof and cost if the Prague day changes after a sound lock', async () => {
    const f = await seed();
    await db.exec("create function public.synthetic_tiktok_rollover() returns trigger language plpgsql as $$begin perform set_config('marketing.test_time','2026-10-25T01:00:00Z',false);return new;end$$;create trigger zz_synthetic_tiktok_rollover before insert on marketing_audio_trends for each row execute function public.synthetic_tiktok_rollover();");
    try {
        expect((await service.rpc('complete_dneskai_tiktok_run', args(f, [item('910014')]))).error?.code).toBe('40001');
        expect((await db.query("select audio_id from marketing_audio_trends where audio_id='910014'")).rows).toEqual([]);
        expect((await db.query('select settled_at from marketing_private.dneskai_topic_spend where id=$1', [f.row.id])).rows).toEqual([{ settled_at: null }]);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_tiktok_rollover on marketing_audio_trends;drop function public.synthetic_tiktok_rollover();');
        await setDatabaseTime(db, now);
    }
});
it('keeps current-day TikTok proof independent of yesterday’s still-current Meta observation', async () => {
    const f = await seed({ reserved: '2026-10-24T10:00:00.000001Z' }), matched = item('910015');
    await db.query("insert into marketing_audio_trends(user_id,audio_id,title,audio_type,first_seen,last_seen,observed_account_id,observed_remote_account_id,observed_verified_at,observed_at) values($1,'910015','Yesterday Meta','music','2026-10-23','2026-10-23',$2,$3,$4,'2026-10-23T11:00:00Z')", [owner, account.id, account.remote_account_id, account.verified_at]);
    expect(await completeDneskaiTikTokRun(service, owner, { account, ...f, matches: [matched], now, signal: signal() })).toBe(1);
    expect((await listDneskaiAudioTrends(service, owner, '2026-10-24')).find(row => row.audioId === matched.audioId)).toMatchObject({ title: 'Yesterday Meta', tiktok: true });
});
it('refuses a legacy unproven Meta writer over a row protected by dated TikTok proof',async()=>{const f=await seed();await completeDneskaiTikTokRun(service,owner,{account,...f,matches:[item('910016')],now,signal:signal()});const result=await service.from('marketing_audio_trends').update({title:'Unproven delayed writer',first_seen:'2026-10-24',last_seen:'2026-10-24',days_seen:99}).eq('user_id',owner).eq('audio_id','910016');expect(result.error?.code).toBe('40001');expect((await db.query("select title,first_seen::text,last_seen::text,days_seen from marketing_audio_trends where audio_id='910016'")).rows).toEqual([{title:'Synthetic matched sound',first_seen:'2026-10-23',last_seen:'2026-10-23',days_seen:1}]);});
