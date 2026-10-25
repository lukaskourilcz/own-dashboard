import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const backend = vi.hoisted(() => ({ api: null as SupabaseClient | null }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => backend.api) }));
import { exportColumns } from '@/lib/data-export-columns';
import { exportTables } from '@/lib/data-export-scopes';
import { GET } from '@/app/api/export/[scope]/route';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', stamp = '2026-10-25T12:00:00Z';
const user = { id: owner, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: stamp } satisfies User;
let db: PGlite, emulator: SupabaseEmulator, requests: Request[];
let intercept: ((request: Request, next: () => Promise<Response>) => Promise<Response>) | undefined;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: stamp }); await db.query('insert into auth.users(id) values($1)', [other]); }, 120000);
beforeEach(async () => {
 await db.exec('reset role; delete from notes; delete from legacy_personal_archives'); intercept = undefined; requests = [];
 emulator = new SupabaseEmulator(db, 'https://offline.supabase.test', { service: 'TEST-ONLY-service', users: { [owner]: 'TEST-ONLY-owner', [other]: 'TEST-ONLY-other' } }, () => new Date(stamp));
 backend.api = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { headers: { Authorization: 'Bearer TEST-ONLY-owner' }, fetch: (input, init) => { const request = new Request(input, init); requests.push(request.clone()); return intercept ? intercept(request, () => emulator.fetch(request)) : emulator.fetch(request); } } });
 vi.spyOn(backend.api.auth, 'getUser').mockResolvedValue({ data: { user }, error: null });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
afterAll(async () => db?.close());
function fakeClock() { vi.useFakeTimers(); vi.spyOn(AbortSignal, 'timeout').mockImplementation(delay => { const controller = new AbortController(); setTimeout(() => controller.abort(new DOMException('Synthetic timeout', 'TimeoutError')), delay); return controller.signal; }); }
function request(scope: string, query = '', options?: RequestInit) { return GET(new Request(`https://app.example.test/api/export/${scope}${query}`, options), { params: Promise.resolve({ scope }) }); }
it('exports a complete owned note collection past the REST cap', async () => {
 await db.query("insert into notes(user_id,title) select $1,'Synthetic note '||n from generate_series(1,1201)n", [owner]);
 await db.query("insert into notes(user_id,title) values($1,'Foreign synthetic note')", [other]);
 intercept = async (request, next) => { const response = await next(); if (new URL(request.url).pathname === '/rest/v1/notes') { const rows = await response.json(); return Response.json(rows.slice(0, 1000), { headers: { 'content-range': '0-999/1201' } }); } return response; };
 const response = await request('notes'); expect(response.status).toBe(200); const body = await response.json(); expect(body.data.notes).toHaveLength(1201); expect(body.data.notes.every((row: { user_id: string }) => row.user_id === owner)).toBe(true);
});
it('reads only the requested table for a single CSV download', async () => {
 const response = await request('financial', '?format=csv&table=transactions'); expect(response.status).toBe(200); expect(emulator.requests).toHaveLength(1);
});
it('validates an unsupported CSV table before querying any data', async () => {
 const response = await request('financial', '?format=csv&table=constructor'); expect(response.status).toBe(400); expect(emulator.requests).toHaveLength(0);
});
it('fails a database query instead of downloading a partial error object', async () => {
 intercept = async () => Response.json({ code: 'TEST-ONLY', message: 'PRIVATE TEST database diagnostic' }, { status: 400 });
 const response = await request('notes'), text = await response.text(); expect({ status: response.status, attachment: response.headers.has('content-disposition'), privateDetail: text.includes('PRIVATE TEST') }).toEqual({ status: 503, attachment: false, privateDetail: false });
});
it('does not revive removed personal tables when an archive read fails', async () => {
 intercept = async () => Response.json({ code: 'TEST-ONLY', message: 'PRIVATE TEST archive failure' }, { status: 400 });
 const response = await request('legacy'); expect(response.status).toBe(503); expect(requests).toHaveLength(1); expect(response.headers.has('content-disposition')).toBe(false);
});

it('reads all combined groups in one snapshot without reading shared project costs twice', async () => {
 const response = await request('full'); expect(response.status).toBe(200);
 const body = await response.json(); expect(body.scope).toBe('full'); expect(body.data).toHaveProperty('account.profile');
 for (const group of ['financial', 'professional', 'knowledge'] as const) expect(Object.keys(body.data[group])).toEqual(exportTables[group]);
 expect(requests).toHaveLength(1); expect(new URL(requests[0].url).pathname).toBe('/rest/v1/rpc/export_owned_records');
 const args = await requests[0].clone().json(); expect(args.p_expected_owner).toBe(owner); expect(args.p_tables).toHaveLength(45);
 expect(args.p_tables.filter((table: string) => table === 'project_costs')).toHaveLength(1);
});
it('retains the existing archive envelope and confirms absence without retired reads', async () => {
 const missing = await request('legacy'); expect((await missing.json()).data).toEqual({ archive: null });
 await db.query('insert into legacy_personal_archives(user_id,payload) values($1,$2)', [owner, { synthetic: ['archived only'] }]);
 const archived = await request('legacy'); const data = (await archived.json()).data;
 expect(data.archive.payload).toEqual({ synthetic: ['archived only'] }); expect(Object.keys(data.archive).sort()).toEqual(['archived_at', 'payload']);
 expect(requests).toHaveLength(2); expect(requests.every(row => new URL(row.url).pathname === '/rest/v1/rpc/export_owned_records')).toBe(true);
});
it.each(['?format=xml', '?format=csv&format=json', '?table=notes', '?format=csv&table=notes&table=notes', '?unexpected=1'])('rejects malformed options before auth/database reads: %s', async query => {
 const response = await request('notes', query); expect(response.status).toBe(400); expect(backend.api!.auth.getUser).not.toHaveBeenCalled(); expect(requests).toHaveLength(0);
});
it.each(['full', 'legacy'])('rejects unsupported CSV scope %s without reading', async scope => {
 expect((await request(scope, '?format=csv')).status).toBe(400); expect(requests).toHaveLength(0);
});
it('returns a private nonattachment 404 for unsupported scope', async () => {
 const response = await request('constructor'); expect(response.status).toBe(404); expect(response.headers.get('cache-control')).toContain('private, no-store'); expect(response.headers.get('vary')).toBe('Cookie'); expect(response.headers.has('content-disposition')).toBe(false);
});
it('requires successful user verification even when an error contains a cached user', async () => {
 vi.mocked(backend.api!.auth.getUser).mockResolvedValue({ data: { user }, error: new Error('PRIVATE TEST auth') } as never);
 const response = await request('notes'); expect(response.status).toBe(401); expect(requests).toHaveLength(0); expect(await response.text()).not.toContain('PRIVATE TEST');
});
it('refuses a captured browser owner different from the verified owner', async () => {
 const response = await request('notes', '', { headers: { 'x-export-owner': other } }); expect(response.status).toBe(409); expect(requests).toHaveLength(0);
});
it('does not attach raw failures or retry a transient database error', async () => {
 intercept = async () => Response.json({ code: 'PRIVATE TEST', message: 'PRIVATE TEST details' }, { status: 503 });
 const response = await request('notes'); expect(response.status).toBe(503); expect(requests).toHaveLength(1); expect(response.headers.has('content-disposition')).toBe(false); expect(await response.text()).not.toContain('PRIVATE TEST');
});
it('explains the explicit database refusal with a smaller-scope action', async () => {
 intercept = async () => Response.json({ code: '54000', message: 'PRIVATE TEST overflow' }, { status: 400 });
 const response = await request('notes'); expect(response.status).toBe(413); expect(await response.text()).toContain('smaller scope'); expect(response.headers.has('content-disposition')).toBe(false);
});
it('bounds uncooperative authentication and prevents a late read', async () => {
 fakeClock(); let finish!: (value: never) => void;
 vi.mocked(backend.api!.auth.getUser).mockImplementation(() => new Promise(resolve => { finish = resolve; }) as never);
 const pending = request('notes'); await vi.advanceTimersByTimeAsync(8001); expect((await pending).status).toBe(503);
 finish({ data: { user }, error: null } as never); await Promise.resolve(); expect(requests).toHaveLength(0);
});
it('aborts an uncooperative query and never creates a late attachment', async () => {
 let finish!: (response: Response) => void; let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
 intercept = () => { started(); return new Promise(resolve => { finish = resolve; }); };
 const controller = new AbortController(), pending = request('notes', '', { signal: controller.signal }); await ready; controller.abort();
 const response = await pending; expect(response.status).toBe(503); expect(response.headers.has('content-disposition')).toBe(false);
 finish(Response.json({ version: 1, owner_id: owner, tables: { notes: [] }, columns: { notes: exportColumns.notes } })); await Promise.resolve(); expect(requests).toHaveLength(1);
});
it('bounds an uncooperative query to fifteen seconds', async () => {
 fakeClock(); intercept = () => new Promise(() => {});
 const pending = request('notes'); await vi.advanceTimersByTimeAsync(15001); expect((await pending).status).toBe(503); expect(requests).toHaveLength(1);
});
it('refuses final combined JSON when a shared table makes the public file exceed the RPC bound', async () => {
 const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 await db.query("insert into projects(id,user_id,name,slug) values($1,$2,'Synthetic export project','synthetic-export')", [project, owner]);
 try {
  await db.query("insert into project_costs(user_id,project_id,label,note) values($1,$2,'Synthetic duplicated group',repeat('x',6*1024*1024))", [owner, project]);
  const response = await request('full'); expect(response.status).toBe(413); expect(response.headers.has('content-disposition')).toBe(false); expect(requests).toHaveLength(1);
 } finally { await db.query('delete from projects where id=$1', [project]); }
});
it.each([
 ['foreign owner', (value: Record<string, unknown>) => { value.owner_id = other; }],
 ['extra table', (value: Record<string, unknown>) => { (value.tables as Record<string, unknown>).unknown = []; }],
 ['missing table', (value: Record<string, unknown>) => { delete (value.tables as Record<string, unknown>).notes; }],
 ['missing columns', (value: Record<string, unknown>) => { value.columns = {}; }],
 ['changed columns', (value: Record<string, unknown>) => { (value.columns as Record<string, unknown>).notes = ['id']; }],
 ['partial envelope', (value: Record<string, unknown>) => { delete value.version; }],
] as const)('refuses a malformed snapshot receipt: %s', async (_, change) => {
 intercept = async (_request, next) => { const value = await (await next()).json(); change(value); return Response.json(value); };
 const response = await request('notes'); expect(response.status).toBe(503); expect(response.headers.has('content-disposition')).toBe(false);
});
