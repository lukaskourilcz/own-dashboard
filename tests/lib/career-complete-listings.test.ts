import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { fetchJobListings, fetchJobUserStates } from '@/lib/queries/fetchers';
import { readCareerRecords, CareerReadError } from '@/lib/career-records';
import { isOsloRelevant } from '@/lib/jobs/filter';
import { normalizeEmployerJob } from '@/lib/jobs/employer-sources';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const backend = vi.hoisted(() => ({ api: null as unknown as SupabaseClient }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => backend.api }));
const other = '22222222-2222-4222-8222-222222222222';
const owner = '11111111-1111-4111-8111-111111111111', now = '2026-10-25T12:00:00Z';
let db: PGlite, service: SupabaseClient, calls: number, fail: string;
const scope = () => ({ ownerId: owner,signal: new AbortController().signal });
beforeAll(async () => {
 db = await createMigratedDatabase({ owner, instant: now });
 await db.query('insert into auth.users(id) values($1)', [other]);
 const emulator = new SupabaseEmulator(db, 'https://example.supabase.co', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner' } }, () => new Date(now));
 calls = 0; fail = '';
 service = createClient('https://example.supabase.co', 'TEST-ONLY-service', { auth: { persistSession: false, autoRefreshToken: false },global: { fetch: (input,init) => emulator.fetch(input,init) } });
 backend.api = createClient('https://example.supabase.co', 'TEST-ONLY-owner', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => { calls++; const request = new Request(input, init); if (fail === 'stall') return new Promise<Response>(()=>{}); if (fail === 'http') return Response.json({ message: 'PRIVATE TEST' }, { status: 503 }); const result = await emulator.fetch(request); if (fail === 'owner') { const value = await result.json(); return Response.json({ ...value,ownerId: other }); } if (fail === 'duplicate') { const value = await result.json(); return Response.json({ ...value,rows: [value.rows[0],value.rows[0]] }); } return result; } } });
}, 60_000);
beforeEach(async () => {
 calls = 0; fail = '';
 await db.exec('truncate job_listings,job_user_state,saved_job_positions,job_applications,job_application_events,cover_letter_templates,job_scrape_runs,career_private.source_snapshots cascade');
 await db.exec(`insert into job_listings(source,external_id,title,url,location,role,remote,tags,description,first_seen_at,last_seen_at) select 'remotive',n::text,'React frontend engineer','https://remotive.com/remote-jobs/synthetic/'||n,'Europe','frontend',true,array['React'],'React TypeScript',now()-n*interval '1 second',now() from generate_series(1,1201)n;`);
 await db.query("insert into job_user_state(user_id,listing_id,state) select $1,id,'deleted' from job_listings where external_id::int<=501", [owner]);
});
afterEach(()=>{ vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => { await db?.close(); });
it('keeps all 700 visible offers accessible when 501 newer permanent deletion markers precede them', async () => {
 const [listings, states] = await Promise.all([fetchJobListings({ ownerId: owner,signal: new AbortController().signal }), fetchJobUserStates({ ownerId: owner,signal: new AbortController().signal })]); const deleted = new Set(states.filter(row => row.state === 'deleted').map(row => row.listing_id));
 expect(states).toHaveLength(501); expect(listings.filter(row => !deleted.has(row.id))).toHaveLength(700);
});

it('never filters another account deletion marker out of the public listing snapshot', async () => {
 await db.query("insert into job_user_state(user_id,listing_id,state) select $1,id,'deleted' from job_listings where external_id='1201'", [other]); const result = await fetchJobListings(scope()); expect(result).toHaveLength(700); expect(result.some(row => row.external_id === '1201')).toBe(true); expect(calls).toBe(1);
});
it.each(['job_user_state','saved_job_positions','job_applications','job_application_events','cover_letter_templates'] as const)('returns an owned complete %s projection without another verification', async entity => {
 for (const [id,who] of [['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',owner],['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',other]]) {
  await db.query("insert into job_applications(id,user_id,title,cover_letter,status,applied_on) values($1,$2,'Synthetic React role','PRIVATE TEST letter','applied','2026-10-25')", [id,who]);
  await db.query("insert into job_application_events(user_id,application_id,kind,detail) values($1,$2,'applied','Synthetic event')", [who,id]);
  await db.query("insert into saved_job_positions(user_id,title,url,cover_letter) values($1,'Synthetic React role',$2,'PRIVATE TEST draft')", [who,`https://thehub.io/jobs/${id}`]);
  await db.query("insert into cover_letter_templates(user_id,name,body) values($1,'Synthetic template','PRIVATE TEST template')", [who]);
 }
 const result = await readCareerRecords(backend.api,entity,scope()); expect(result.data.length).toBe(entity === 'job_user_state' ? 501 : 1); expect(result.data.every(row => row.user_id === owner)).toBe(true); expect(calls).toBe(1);
});
it.each(['owner','duplicate','http'])('refuses malformed or uncertain %s evidence in one attempt', async kind => { fail = kind; await expect(fetchJobListings(scope())).rejects.toBeInstanceOf(CareerReadError); expect(calls).toBe(1); });
it('refuses a captured-owner mismatch even for an empty collection before private data can cross scope', async () => { await expect(readCareerRecords(backend.api,'saved_job_positions',{ ...scope(),ownerId: other })).rejects.toBeInstanceOf(CareerReadError); expect(calls).toBe(1); });
it('does not transmit an invalid owner or already cancelled read', async () => {
 await expect(fetchJobListings({ ...scope(),ownerId: 'invalid' })).rejects.toBeInstanceOf(CareerReadError); expect(calls).toBe(0); const parent = new AbortController(); parent.abort(); await expect(fetchJobListings({ ownerId: owner,signal: parent.signal })).rejects.toMatchObject({ name: 'AbortError' }); expect(calls).toBe(0);
});
it('preserves captured owner identity before a deferred module load', async () => { const original = scope(); const pending = fetchJobListings(original); original.ownerId = other; expect(await pending).toHaveLength(700); expect(calls).toBe(1); });
it('keeps historical native remote booleans unverified until a new strict source snapshot', async () => {
 await db.query("insert into job_listings(source,external_id,title,url,location,role,remote,tags,description,last_seen_at) values('ashby-sanity','native','React frontend engineer','https://jobs.ashbyhq.com/sanity/native','Europe','frontend',true,array['React'],'React TypeScript','2026-10-25T11:00:00Z')");
 const before = (await fetchJobListings(scope())).find(row => row.source === 'ashby-sanity')!; expect(before.remote).toBe(false); expect(isOsloRelevant(before)).toBe(false); expect((await db.query("select remote,native_remote_verified from job_listings where source='ashby-sanity'")).rows[0]).toEqual({ remote: true,native_remote_verified: false });
 const job = normalizeEmployerJob({ id: 'native',title: 'React frontend engineer',jobUrl: before.url,location: 'Europe',descriptionPlain: 'React TypeScript',workplaceType: 'Remote' },{ id: 'ashby-sanity',name: 'Synthetic' })!;
 const rpc = await service.rpc('career_apply_source_snapshot',{ p_source: job.source,p_observed_at: now,p_complete: false,p_rows: [{ external_id: job.externalId,title: job.title,company: job.company,url: job.url,location: job.location,role: job.role,remote: job.remote,salary: job.salary,tags: job.tags,seniority: job.seniority,description: job.description,posted_at: job.postedAt }] }); expect(rpc.error).toBeNull();
 const after = (await fetchJobListings(scope())).find(row => row.source === 'ashby-sanity')!; expect(after.remote).toBe(true); expect(isOsloRelevant(after)).toBe(true);
});
it('reads 1,201 private saved records as one complete owned envelope beyond the REST row cap', async () => {
 await db.query("insert into saved_job_positions(user_id,title,url,cover_letter) select $1,'Synthetic saved React role','https://thehub.io/jobs/saved-'||n,'Synthetic private draft' from generate_series(1,1201)n",[owner]);
 const result = await readCareerRecords(backend.api,'saved_job_positions',scope()); expect(result.data).toHaveLength(1201); expect(new Set(result.data.map(row=>row.id)).size).toBe(1201); expect(calls).toBe(1);
});
it('keeps future private columns outside the reviewed projection', async () => {
 await db.exec("alter table cover_letter_templates add column future_private_field text default 'TEST-ONLY future field'"); await db.query("insert into cover_letter_templates(user_id,name,body) values($1,'Synthetic future-column case','Synthetic template')",[owner]);
 const result = await readCareerRecords(backend.api,'cover_letter_templates',scope()); expect(result.data).toHaveLength(1); expect(result.data[0]).not.toHaveProperty('future_private_field');
});
it('refuses row and JSON overflow instead of returning a prefix or invented empty collection', async () => {
 await db.query("insert into cover_letter_templates(user_id,name,body) select $1,'Synthetic template','small' from generate_series(1,10001)",[owner]); await expect(readCareerRecords(backend.api,'cover_letter_templates',scope())).rejects.toBeInstanceOf(CareerReadError);
 await db.query('delete from cover_letter_templates'); await db.query("insert into cover_letter_templates(user_id,name,body) values($1,'Synthetic oversized template',repeat('a',10485761))",[owner]); await expect(readCareerRecords(backend.api,'cover_letter_templates',scope())).rejects.toBeInstanceOf(CareerReadError);
});
it('never lets a service client read a private collection through the authenticated-only RPC', async () => { const result = await service.rpc('read_career_records',{ p_entity: 'saved_job_positions',p_expected_owner: owner }); expect(result.error).not.toBeNull(); expect(result.data).toBeNull(); });

it('bounds an uncooperative read at fifteen seconds without retrying', async () => {
 vi.useFakeTimers(); vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{ const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal; }); fail='stall';
 const pending=fetchJobListings(scope()),check=expect(pending).rejects.toBeInstanceOf(CareerReadError); await vi.advanceTimersByTimeAsync(0);expect(calls).toBe(1);await vi.advanceTimersByTimeAsync(15_001);await check;expect(calls).toBe(1);
});
it('retires an admitted read promptly on parent cancellation', async () => {
 fail='stall';const parent=new AbortController(),pending=fetchJobListings({ ownerId: owner,signal:parent.signal }),check=expect(pending).rejects.toMatchObject({ name:'AbortError' });await vi.waitFor(()=>expect(calls).toBe(1));parent.abort();await check;expect(calls).toBe(1);
});
