import type { PGlite } from '@electric-sql/pglite';
import { createClient } from '@supabase/supabase-js';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { planCampaignImport } from '@/lib/marketing/campaign-import';

const owner = '11111111-1111-4111-8111-111111111111';
const other = '99999999-9999-4999-8999-999999999999';
const idea = '33333333-3333-4333-8333-333333333333';
let db: PGlite;
const prepared = () => planCampaignImport({ schemaVersion: 'marketing-calendar/1', project: 'devshark', name: 'Authored fixture', launch: '2026-11-01', entries: [
 { id: 'one', date: '2026-11-01', title: 'A useful first idea', kind: 'post', platform: 'instagram', tipRefs: ['Matching tip'] },
 { id: 'two', date: '2026-11-02', title: 'A useful second idea', kind: 'thread', platform: 'threads' },
]}, '2026-11-01', [{ id: idea, title: 'Matching tip' }]);
async function invoke(value = prepared(), actor = owner) {
 return (await db.query<{ id: string }>('select public.marketing_import_campaign($1,$2,$3) as id', [actor, JSON.stringify(value.campaign), JSON.stringify(value.entries)])).rows[0].id;
}
async function counts() {
 return (await db.query('select (select count(*)::int from marketing_campaigns) as campaigns, (select count(*)::int from marketing_calendar_entries) as entries')).rows[0];
}
beforeAll(async () => {
 db = await createMigratedDatabase({ owner, instant: '2026-10-29T00:00:00Z', beforeMigration: '20261028233906_confirmed_marketing_campaign_import.sql' });
 await db.query('insert into auth.users(id) values($1)', [other]);
 await db.query("insert into ai_links(id,user_id,record_type,title,url) values($1,$2,'idea','Matching tip','https://example.test/tip')", [idea, owner]);
 const id = await invoke();
 const snapshot = async () => (await db.query('select (select jsonb_agg(c order by id) from marketing_campaigns c) as campaigns,(select jsonb_agg(e order by id) from marketing_calendar_entries e) as entries')).rows[0];
 const before = await snapshot();
 if (process.env.AUDIT_ORIGINAL_CAMPAIGN_IMPORT !== '1') await db.exec(readFileSync('supabase/migrations/20261028233906_confirmed_marketing_campaign_import.sql', 'utf8'));
 expect(await snapshot()).toEqual(before); expect(await invoke()).toBe(id);

}, 120_000);
beforeEach(async () => {
 for (const table of ['marketing_campaigns', 'marketing_calendar_entries']) await db.exec(`drop trigger if exists audit_import on public.${table}`);
 await db.exec('truncate public.marketing_calendar_entries,public.marketing_campaigns cascade');
});
afterAll(async () => { await db.close(); });
it('persists all planned fields and owned references in one transaction', async () => {
 const value = prepared(), id = await invoke(value);
 expect(id).toMatch(/^[a-f0-9-]{36}$/); expect(await counts()).toEqual({ campaigns: 1, entries: 2 });
 expect((await db.query('select user_id,source_snapshot,source_hash,status from marketing_campaigns where id=$1', [id])).rows[0]).toEqual({ user_id: owner, source_snapshot: value.campaign.source_snapshot, source_hash: value.campaign.source_hash, status: 'draft' });
 const rows = (await db.query('select source_id,date::text,local_time,kind,platform,title,original,knowledge_ids,status,needs_review from marketing_calendar_entries where campaign_id=$1 order by source_id', [id])).rows;
 expect(rows).toEqual(value.entries);
});
it('replays the exact source/start without erasing owner edits or creating another campaign', async () => {
 const id = await invoke();
 await db.query("update marketing_campaigns set name='Owner name',status='active' where id=$1", [id]);
 await db.query("update marketing_calendar_entries set title='Owner title',status='blocked',date='2026-11-03' where campaign_id=$1 and source_id='one'", [id]);
 expect(await invoke()).toBe(id); expect(await counts()).toEqual({ campaigns: 1, entries: 2 });
 expect((await db.query('select name,status from marketing_campaigns where id=$1', [id])).rows[0]).toEqual({ name: 'Owner name', status: 'active' });
 expect((await db.query("select title,status,date::text from marketing_calendar_entries where campaign_id=$1 and source_id='one'", [id])).rows[0]).toEqual({ title: 'Owner title', status: 'blocked', date: '2026-11-03' });
});
it.each(['skip-entry','change-entry','change-campaign','skip-campaign'] as const)('refuses post-trigger %s and rolls back the whole new import', async mode => {
 const campaign = mode.endsWith('campaign');
 const body = mode.startsWith('skip') ? 'return null;' : campaign ? "new.source_snapshot = '{}'::jsonb; return new;" : "new.title = 'Changed by trigger'; return new;";
 await db.exec(`create or replace function public.audit_import() returns trigger language plpgsql as $$begin ${body} end$$; create trigger audit_import before insert on public.${campaign ? 'marketing_campaigns' : 'marketing_calendar_entries'} for each row execute function public.audit_import();`);
 await expect(invoke()).rejects.toThrow(); expect(await counts()).toEqual({ campaigns: 0, entries: 0 });
});
it('checks persisted rows after an AFTER trigger rather than trusting INSERT RETURNING', async () => {
 await db.exec("create or replace function public.audit_import() returns trigger language plpgsql as $$begin update public.marketing_calendar_entries set title='Changed after insert' where id=new.id; return new; end$$; create trigger audit_import after insert on public.marketing_calendar_entries for each row execute function public.audit_import();");
 await expect(invoke()).rejects.toThrow(); expect(await counts()).toEqual({ campaigns: 0, entries: 0 });
});
it('refuses a replay with a missing or replaced original instead of recreating owner-deleted rows', async () => {
 const id = await invoke();
 await db.query("delete from marketing_calendar_entries where campaign_id=$1 and source_id='two'", [id]);
 await expect(invoke()).rejects.toThrow(); expect(await counts()).toEqual({ campaigns: 1, entries: 1 });
});
it('refuses changed immutable source evidence on replay', async () => {
 const id = await invoke();
 await db.query("update marketing_calendar_entries set original='{}'::jsonb where campaign_id=$1 and source_id='one'", [id]);
 await expect(invoke()).rejects.toThrow();
});
it('rolls back foreign knowledge, duplicate source IDs and a missing owner', async () => {
 const foreign = prepared(); foreign.entries[0].knowledge_ids = ['44444444-4444-4444-8444-444444444444'];
 await db.query("insert into ai_links(id,user_id,record_type,title,url) values($1,$2,'idea','Other idea','https://example.test/foreign')", [foreign.entries[0].knowledge_ids[0], other]);
 await expect(invoke(foreign)).rejects.toThrow();
 const duplicate = prepared(); duplicate.entries[1].source_id = duplicate.entries[0].source_id;
 await expect(invoke(duplicate)).rejects.toThrow();
 await expect(invoke(prepared(), '55555555-5555-4555-8555-555555555555')).rejects.toThrow();
 expect(await counts()).toEqual({ campaigns: 0, entries: 0 });
});
it('isolates identical sources for two owners and enforces authenticated RLS and service-only invocation', async () => {
 const value = prepared(); value.entries.forEach(row => { row.knowledge_ids = []; });
 const id = await invoke(value), foreignId = await invoke(value, other); expect(id).not.toBe(foreignId);
 expect((await db.query("select has_function_privilege('anon','public.marketing_import_campaign(uuid,jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','public.marketing_import_campaign(uuid,jsonb,jsonb)','execute') as authenticated,has_function_privilege('service_role','public.marketing_import_campaign(uuid,jsonb,jsonb)','execute') as service")).rows[0]).toEqual({ anon: false, authenticated: false, service: true });
 await db.exec('set role authenticated'); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner]);
 expect((await db.query('select id from public.marketing_campaigns')).rows).toEqual([{ id }]);
 expect((await db.query('select distinct campaign_id from public.marketing_calendar_entries')).rows).toEqual([{ campaign_id: id }]);
 await expect(invoke()).rejects.toThrow('permission denied'); await db.exec('reset role');
 expect((await db.query<{ count: number }>('select count(*)::int as count from marketing_publications')).rows[0].count).toBe(0);
});

it('runs with actual service-role table grants without auth.users read access', async () => {
 await db.exec('set role service_role');
 try { expect(await invoke()).toMatch(/^[a-f0-9-]{36}$/); }
 finally { await db.exec('reset role'); }
 expect(await counts()).toEqual({ campaigns: 1, entries: 2 });
});
it.each(['foreign-parent', 'extra-entry'] as const)('refuses an AFTER entry trigger that changes %s', async mode => {
 const body = mode === 'foreign-parent'
  ? `update public.marketing_campaigns set source_snapshot='{}'::jsonb where id=new.campaign_id;`
  : `if new.source_id='one' then insert into public.marketing_calendar_entries(user_id,campaign_id,source_id,date,kind,platform,title,original) values(new.user_id,new.campaign_id,'extra',new.date,new.kind,new.platform,new.title,new.original); end if;`;
 await db.exec(`create or replace function public.audit_import() returns trigger language plpgsql as $$begin ${body} return new; end$$; create trigger audit_import after insert on public.marketing_calendar_entries for each row execute function public.audit_import();`);
 await expect(invoke()).rejects.toThrow(); expect(await counts()).toEqual({ campaigns: 0, entries: 0 });
});
it('supports an explicitly empty authored plan and a separate shifted start', async () => {
 const empty = prepared(); empty.entries = []; empty.campaign.source_snapshot.entries = [];
 const id = await invoke(empty); expect(await invoke(empty)).toBe(id); expect(await counts()).toEqual({ campaigns: 1, entries: 0 });
 const shifted = prepared(); shifted.campaign.starts_on = '2026-11-08'; shifted.campaign.ends_on = '2026-11-14';
 expect(await invoke(shifted)).not.toBe(id); expect(await counts()).toEqual({ campaigns: 2, entries: 2 });
});

it('can roll back the function definition without changing imported data', async () => {
 const id = await invoke();
 const snapshot = async () => (await db.query('select (select jsonb_agg(c order by id) from marketing_campaigns c) as campaigns,(select jsonb_agg(e order by id) from marketing_calendar_entries e) as entries')).rows[0];
 const before = await snapshot();
 const original = readFileSync('supabase/migrations/20261013193104_marketing_control_surface.sql', 'utf8').split('create function public.marketing_import_campaign(')[1];
 try {
  await db.exec('create or replace function public.marketing_import_campaign(' + original);
  expect(await snapshot()).toEqual(before); expect(await invoke()).toBe(id);
 } finally { await db.exec(readFileSync('supabase/migrations/20261028233906_confirmed_marketing_campaign_import.sql', 'utf8')); }
 expect(await snapshot()).toEqual(before);
});

it('uses the actual SDK for one no-retry service RPC with the existing UUID contract', async () => {
 const emulator = new SupabaseEmulator(db, 'https://campaign-import.supabase.test', { service: 'TEST-ONLY-SERVICE', users: { [owner]: 'TEST-ONLY-OWNER' } });
 const client = createClient('https://campaign-import.supabase.test', 'TEST-ONLY-SERVICE', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: emulator.fetch.bind(emulator) } });
 const value = prepared();
 const result = await client.rpc('marketing_import_campaign', { p_owner: owner, p_campaign: value.campaign, p_entries: value.entries }).retry(false).abortSignal(AbortSignal.timeout(15_000));
 expect(result.error).toBeNull(); expect(result.data).toMatch(/^[a-f0-9-]{36}$/);
 expect(emulator.requests).toHaveLength(1); expect(await counts()).toEqual({ campaigns: 1, entries: 2 });
});
it('admits exactly 1,000 authored entries and refuses an excess without partial persistence', async () => {
 const value = prepared(); value.entries = Array.from({ length: 1000 }, (_, i) => ({ ...value.entries[1], source_id: `item-${i}` }));
 await invoke(value); expect(await counts()).toEqual({ campaigns: 1, entries: 1000 });
 const excess = prepared(); excess.campaign.starts_on = '2026-11-08'; excess.campaign.ends_on = '2026-11-14'; excess.entries = [...value.entries, { ...value.entries[1], source_id: 'excess' }];
 await expect(invoke(excess)).rejects.toThrow('input invalid'); expect(await counts()).toEqual({ campaigns: 1, entries: 1000 });
});
it.each(['bad-time', 'excess-source-id', 'wrong-source-brand', 'wrong-week'] as const)('refuses %s before creating rows', async kind => {
 const value = prepared();
 if (kind === 'bad-time') value.entries[0].local_time = '24:00';
 if (kind === 'excess-source-id') value.entries[0].source_id = 'a'.repeat(301);
 if (kind === 'wrong-source-brand') value.campaign.source_snapshot.project = 'dneskai';
 if (kind === 'wrong-week') value.campaign.ends_on = '2026-11-08';
 await expect(invoke(value)).rejects.toThrow('input invalid'); expect(await counts()).toEqual({ campaigns: 0, entries: 0 });
});
