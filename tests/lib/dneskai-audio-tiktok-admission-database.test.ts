import { readFileSync } from 'node:fs';
import { completeDneskaiTikTokRun } from '@/lib/marketing/dneskai-tiktok-progress';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { databaseVersion } from '@/lib/database-version';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { reserveDneskaiTikTokRun, bindDneskaiTikTokRun, type DneskaiTikTokAdmission } from '@/lib/marketing/dneskai-tiktok-admission';
import { observationOwner as owner, observationAccount as account } from '../helpers/dneskai-audio-observation-fixtures';
vi.mock('server-only', () => ({}));
const now = new Date('2026-10-24T12:00:00Z');
let databaseNow = now;
let db: PGlite, service: SupabaseClient;
const signal = () => new AbortController().signal;
const reserve = () => reserveDneskaiTikTokRun(service, owner, { account, now, ceilingUsd: 0.1, signal: signal() });
const provider = (admission: DneskaiTikTokAdmission) => ({
    id: 'run_' + admission.spendId.replaceAll('-', ''), actorId: 'sDvA9jM4WRTDX4Syr' as const, datasetId: 'dataset_' + admission.spendId.replaceAll('-', ''), startedAt: admission.reservedAt
});
beforeAll(async () => {
    db = await createMigratedDatabase({ owner, instant: now });
    await db.query("insert into marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram',$3,'synthetic',$4,false)", [account.id, owner, account.remote_account_id, account.verified_at]);
    const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: {} }, () => databaseNow);
    service = createClient('https://example.supabase.co', 'TEST-ONLY-service', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => emulator.fetch(input, init) } });
}, 60000);
afterAll(async () => {
    await db?.close();
});
it('returns one captured positive owner/account/actor/input reservation through the full migration chain', async () => {
    const admission = await reserve();
    expect(admission).toMatchObject({
        ownerId: owner, accountId: account.id, remoteAccountId: account.remote_account_id, enabled: false, day: '2026-10-24', reservationUsd: 0.1, actorId: 'sDvA9jM4WRTDX4Syr', input: { resultsPerPage: 25, adsSoundsCountryCode: 'CZ' }
    });
    expect(databaseVersion(admission!.verifiedAt)).toBe(databaseVersion(account.verified_at));
    const stored = (await db.query<{
        tiktok_admission: unknown;
    }>('select tiktok_admission from marketing_private.dneskai_topic_spend where id=$1', [admission!.spendId])).rows[0].tiktok_admission;
    expect(stored).toEqual(admission);
    expect(await reserve()).toBeNull();
});
it('binds the registered provider against original admission and replays only the exact binding', async () => {
    const row = (await db.query<{
        tiktok_admission: DneskaiTikTokAdmission;
    }>('select tiktok_admission from marketing_private.dneskai_topic_spend where user_id=$1', [owner])).rows[0];
    const admission = row.tiktok_admission, run = provider(admission);
    await bindDneskaiTikTokRun(service, owner, { admission, provider: run, now, signal: signal() });
    const before = (await db.query('select ref,tiktok_binding,tiktok_admission from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows;
    await bindDneskaiTikTokRun(service, owner, { admission, provider: run, now, signal: signal() });
    expect((await db.query('select ref,tiktok_binding,tiktok_admission from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows).toEqual(before);
    await expect(bindDneskaiTikTokRun(service, owner, { admission, provider: { ...run, datasetId: 'different' }, now, signal: signal() })).rejects.toThrow('tiktok-bind-unavailable');
});
it('refuses legacy unreceipted binding and settlement over captured admissions', async () => {
    const row = (await db.query<{
        tiktok_admission: DneskaiTikTokAdmission;
    }>('select tiktok_admission from marketing_private.dneskai_topic_spend where user_id=$1', [owner])).rows[0];
    const admission = row.tiktok_admission;
    expect((await service.rpc('marketing_settle_dneskai_topic_spend', { p_owner: owner, p_id: admission.spendId, p_cost: 0.01 })).error?.code).toBe('40001');
    await expect(db.query("update marketing_private.dneskai_topic_spend set tiktok_admission=jsonb_set(tiktok_admission,'{remoteAccountId}','\"9\"') where id=$1", [admission.spendId])).rejects.toThrow('TikTok admission proof required');
});
async function fresh() {
    const actor = crypto.randomUUID(), captured = { ...account, id: crypto.randomUUID(), user_id: actor };
    await db.query('insert into auth.users(id) values($1)', [actor]);
    await db.query("insert into marketing_accounts(id,user_id,brand,platform,remote_account_id,handle,verified_at,enabled) values($1,$2,'dneskai','instagram',$3,'synthetic',$4,false)", [captured.id, actor, captured.remote_account_id, captured.verified_at]);
    return { owner: actor, account: captured };
}
const admit = (f: Awaited<ReturnType<typeof fresh>>) => reserveDneskaiTikTokRun(service, f.owner, { account: f.account, now, ceilingUsd: 0.1, signal: signal() });
it('records a known provider identity after account re-verification while refusing new intent from the old tuple', async () => {
    const f = await fresh(), admission = (await admit(f))!;
    await db.query("update marketing_accounts set remote_account_id='9',verified_at='2026-10-24T11:00:00.000001Z' where id=$1", [f.account.id]);
    await bindDneskaiTikTokRun(service, f.owner, { admission, provider: provider(admission), now, signal: signal() });
    await expect(admit(f)).rejects.toThrow('tiktok-admission-unavailable');
    expect(await reserveDneskaiTikTokRun(service, f.owner, { account: { ...f.account, remote_account_id: '9', verified_at: '2026-10-24T11:00:00.000001Z' }, now, ceilingUsd: 0.1, signal: signal() })).toBeNull();
});
it.each(['suppress', 'alter'])('rolls back an admission whose persisted receipt is %s', async (mode) => {
    const f = await fresh();
    await db.exec(`create function marketing_private.synthetic_admission_refusal() returns trigger language plpgsql as $$begin if new.user_id='${f.owner}' and new.tiktok_admission is not null then ${mode === 'suppress' ? 'return null;' : "new.reserved_usd:=0.2;"} end if;return new;end$$;create trigger zz_synthetic_admission_refusal before update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.synthetic_admission_refusal();`);
    try {
        await expect(admit(f)).rejects.toThrow('tiktok-admission-unavailable');
        expect((await db.query('select id from marketing_private.dneskai_topic_spend where user_id=$1', [f.owner])).rows).toEqual([]);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_admission_refusal on marketing_private.dneskai_topic_spend;drop function marketing_private.synthetic_admission_refusal();');
    }
});
it('refuses old Boolean binding writes over an unbound captured reservation', async () => {
    const f = await fresh(), admission = (await admit(f))!;
    expect((await service.rpc('marketing_dneskai_tiktok_bind', { p_owner: f.owner, p_id: admission.spendId, p_ref: 'tiktok:legacy:legacy' })).error?.code).toBe('40001');
    expect((await db.query('select ref from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows).toEqual([{ ref: 'tiktok:pending' }]);
});
it('refuses altered original admission without changing its pending reservation', async () => {
    const f = await fresh(), admission = (await admit(f))!;
    for (const patch of [{ remoteAccountId: '9' }, { day: '2026-10-25' }, { reservationUsd: 0.2 }, { verifiedAt: '2026-10-20T00:00:00.000002Z' }]) {
        expect((await service.rpc('bind_dneskai_tiktok_run', { p_owner: f.owner, p_admission: { ...admission, ...patch }, p_provider: provider(admission) })).error).not.toBeNull();
    }
    expect((await db.query('select ref from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows).toEqual([{ ref: 'tiktok:pending' }]);
});
it.each(['suppress', 'alter'])('keeps a known provider start uncertain when binding is %s', async (mode) => {
    const f = await fresh(), admission = (await admit(f))!;
    await db.exec(`create function marketing_private.synthetic_binding_refusal() returns trigger language plpgsql as $$begin if new.id='${admission.spendId}' and new.tiktok_binding is not null then ${mode === 'suppress' ? 'return null;' : "new.ref:='tiktok:altered:altered';"} end if;return new;end$$;create trigger zz_synthetic_binding_refusal before update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.synthetic_binding_refusal();`);
    try {
        await expect(bindDneskaiTikTokRun(service, f.owner, { admission, provider: provider(admission), now, signal: signal() })).rejects.toThrow('tiktok-bind-unavailable');
        expect((await db.query('select ref,tiktok_binding,cost_usd,settled_at from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows).toEqual([{ ref: 'tiktok:pending', tiktok_binding: null, cost_usd: null, settled_at: null }]);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_binding_refusal on marketing_private.dneskai_topic_spend;drop function marketing_private.synthetic_binding_refusal();');
    }
});
it.each([{ p_remote: '9' }, { p_enabled: true }, { p_verified_at: '2026-10-20T00:00:00.000002Z' }, { p_day: '2026-10-25' }, { p_requested_at: 'infinity' }, { p_requested_at: '2026-10-24T11:54:59Z' }, { p_ceiling: 1.01 }, { p_ceiling: 0 }])('refuses stale/invalid admission before creating a reservation: %j', async (patch) => {
    const f = await fresh();
    const result = await service.rpc('reserve_dneskai_tiktok_run', {
        p_owner: f.owner, p_account: f.account.id, p_remote: f.account.remote_account_id, p_verified_at: f.account.verified_at, p_enabled: false, p_day: '2026-10-24', p_requested_at: now.toISOString(), p_ceiling: 0.1, ...patch
    });
    expect(result.error).not.toBeNull();
    expect((await db.query('select id from marketing_private.dneskai_topic_spend where user_id=$1', [f.owner])).rows).toEqual([]);
});
it('does not allow a second ledger row to reuse a provider run id', async () => {
    const f = await fresh(), first = (await admit(f))!;
    await bindDneskaiTikTokRun(service, f.owner, { admission: first, provider: provider(first), now, signal: signal() });
    const id = crypto.randomUUID(), second = { ...first, spendId: id };
    await db.query("insert into marketing_private.dneskai_topic_spend(id,user_id,kind,ref,reserved_usd,reserved_at,tiktok_admission) values($1,$2,'tiktok','tiktok:pending',0.1,$3,$4)", [id, f.owner, second.reservedAt, JSON.stringify(second)]);
    await expect(bindDneskaiTikTokRun(service, f.owner, { admission: second, provider: provider(first), now, signal: signal() })).rejects.toThrow('tiktok-bind-unavailable');
    expect((await db.query('select ref from marketing_private.dneskai_topic_spend where id=$1', [id])).rows).toEqual([{ ref: 'tiktok:pending' }]);
});
it('protects final admission fields even from a later BEFORE trigger', async () => {
    const f = await fresh(), admission = (await admit(f))!;
    await db.exec(`create function marketing_private.synthetic_late_admission_change() returns trigger language plpgsql as $$begin if new.id='${admission.spendId}' then new.tiktok_admission:=jsonb_set(new.tiktok_admission,'{remoteAccountId}','"9"');end if;return new;end$$;create trigger zz_synthetic_late_admission_change before update on marketing_private.dneskai_topic_spend for each row execute function marketing_private.synthetic_late_admission_change();`);
    try {
        await expect(bindDneskaiTikTokRun(service, f.owner, { admission, provider: provider(admission), now, signal: signal() })).rejects.toThrow('tiktok-bind-unavailable');
        expect((await db.query<{
            tiktok_admission: unknown;
        }>('select tiktok_admission from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows[0].tiktok_admission).toEqual(admission);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_late_admission_change on marketing_private.dneskai_topic_spend;drop function marketing_private.synthetic_late_admission_change();');
    }
});
it('keeps new functions service-only without changing private-table browser access', async () => {
    for (const fn of ['public.reserve_dneskai_tiktok_run(uuid,uuid,text,timestamptz,boolean,date,timestamptz,numeric)', 'public.bind_dneskai_tiktok_run(uuid,jsonb,jsonb)']) {
        expect((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed,has_function_privilege('authenticated',$1,'EXECUTE') browser", [fn])).rows).toEqual([{ allowed: false, browser: false }]);
    }
    expect((await db.query("select has_table_privilege('authenticated','marketing_private.dneskai_topic_spend','SELECT') allowed")).rows).toEqual([{ allowed: false }]);
});
it('completes a newly admitted and bound run through the atomic measured-cost contract', async () => {
    const f = await fresh(), admission = (await admit(f))!, registered = provider(admission);
    await bindDneskaiTikTokRun(service, f.owner, { admission, provider: registered, now, signal: signal() });
    databaseNow = new Date(now.getTime() + 20000);
    try {
        expect(await completeDneskaiTikTokRun(service, f.owner, {
            account: f.account, row: { id: admission.spendId, ref: `tiktok:${registered.id}:${registered.datasetId}`, reserved_at: admission.reservedAt, reserved_usd: 0.1, settled: false, cost_usd: null, processed: false }, run: { ...registered, status: 'SUCCEEDED', usageUsd: 0.076, finishedAt: admission.reservedAt }, matches: [{ audioId: '123456789', title: 'Synthetic complete chain', artist: null }], now: databaseNow, signal: signal()
        })).toBe(1);
        expect((await db.query('select cost_usd::text,tiktok_receipt is not null processed from marketing_private.dneskai_topic_spend where id=$1', [admission.spendId])).rows).toEqual([{ cost_usd: '0.0760', processed: true }]);
    }
    finally {
        databaseNow = now;
    }
});
it('rolls back a reservation if the Prague day changes during its insertion', async () => {
    const f = await fresh();
    await db.exec(`create function marketing_private.synthetic_admission_rollover() returns trigger language plpgsql as $$begin if new.user_id='${f.owner}' then perform set_config('marketing.test_time','2026-10-25T01:00:00Z',false);end if;return new;end$$;create trigger zz_synthetic_admission_rollover before insert on marketing_private.dneskai_topic_spend for each row execute function marketing_private.synthetic_admission_rollover();`);
    try {
        await expect(admit(f)).rejects.toThrow('tiktok-admission-unavailable');
        expect((await db.query('select id from marketing_private.dneskai_topic_spend where user_id=$1', [f.owner])).rows).toEqual([]);
    }
    finally {
        await db.exec('drop trigger zz_synthetic_admission_rollover on marketing_private.dneskai_topic_spend;drop function marketing_private.synthetic_admission_rollover();');
    }
});
it('preserves populated history and restores the previous trigger timing on migration rollback', async () => {
    const migration = '20261027061021_captured_dneskai_tiktok_admission.sql', upgrade = await createMigratedDatabase({ owner, instant: now, beforeMigration: migration });
    try {
        await upgrade.query("insert into marketing_private.dneskai_topic_spend(user_id,kind,ref,reserved_usd) values($1,'tiktok','tiktok:pending',0.1)", [owner]);
        const before = (await upgrade.query('select id,user_id,ref,reserved_usd,reserved_at,cost_usd,settled_at,tiktok_fingerprint,tiktok_receipt from marketing_private.dneskai_topic_spend')).rows;
        await upgrade.exec('begin;' + readFileSync(`supabase/migrations/${migration}`, 'utf8'));
        expect((await upgrade.query('select id,user_id,ref,reserved_usd,reserved_at,cost_usd,settled_at,tiktok_fingerprint,tiktok_receipt from marketing_private.dneskai_topic_spend')).rows).toEqual(before);
        await upgrade.exec('rollback');
        expect((await upgrade.query("select to_regprocedure('public.bind_dneskai_tiktok_run(uuid,jsonb,jsonb)') present")).rows).toEqual([{ present: null }]);
        expect((await upgrade.query("select (tgtype::int & 2)=2 before_trigger from pg_trigger where tgname='guard_dneskai_tiktok_completion'")).rows).toEqual([{ before_trigger: true }]);
        expect((await upgrade.query('select id,user_id,ref,reserved_usd,reserved_at,cost_usd,settled_at,tiktok_fingerprint,tiktok_receipt from marketing_private.dneskai_topic_spend')).rows).toEqual(before);
    }
    finally {
        await upgrade.close();
    }
}, 60000);
