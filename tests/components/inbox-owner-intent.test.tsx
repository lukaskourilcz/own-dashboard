// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { OwnerQueryProvider } from '@/components/owner-query-provider';
import { InboxPanel } from '@/components/panels/inbox-panel';
import { professional } from '@/lib/i18n/sections/professional';
import { common } from '@/lib/i18n/sections/common';
const backend = vi.hoisted(() => ({ api: null as SupabaseClient | null }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => backend.api }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ professional: professional.en, common: common.en }), useLang: () => ({ lang: 'en' }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn() }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const title = 'Synthetic A private intent', stamp = '2026-10-25T12:00:00Z';
let sequence = 0;
let sessions: Record<string, ReturnType<typeof syntheticSession>>;
let db: PGlite, root: Root, host: HTMLDivElement, clients: Map<string, QueryClient>;
function syntheticSession(id: string) {
 const exp = Math.floor(Date.now() / 1000) + 3600, encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
 return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, aud: 'authenticated', role: 'authenticated', exp })}.TEST-ONLY-SIGNATURE`, refresh_token: 'TEST-ONLY-REFRESH' };
}
function View({ actor }: { actor: string }) { const client = useQueryClient(); useLayoutEffect(() => { clients.set(actor, client); }); return <InboxPanel items={[]} setItems={() => {}} notifications={[]} setNotifications={() => {}} />; }
function render(actor = owner) { act(() => root.render(<OwnerPreferencesProvider ownerId={actor}><OwnerQueryProvider ownerId={actor}><View actor={actor} /></OwnerQueryProvider></OwnerPreferencesProvider>)); }
function submit() { act(() => { const input = host.querySelector<HTMLInputElement>('form input')!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, title); input.dispatchEvent(new Event('input', { bubbles: true })); }); act(() => host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))); }
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: stamp }); await db.query('insert into auth.users(id) values($1)', [other]); }, 120000);
beforeEach(async () => {
 await db.exec('reset role; delete from inbox_items'); clients = new Map(); sessions = { [owner]: syntheticSession(owner), [other]: syntheticSession(other) };
 const emulator = new SupabaseEmulator(db, 'https://offline.supabase.test', { service: 'TEST-ONLY-service', users: { [owner]: sessions[owner].access_token, [other]: sessions[other].access_token } }, () => new Date(stamp));
 backend.api = createClient('https://offline.supabase.test', 'TEST-ONLY-public', { auth: { storageKey: `TEST-ONLY-inbox-intent-${++sequence}`, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => {
  const request = new Request(input, init);
  if (new URL(request.url).pathname === '/auth/v1/user') { const actor = [owner, other].find(id => request.headers.get('authorization') === `Bearer ${sessions[id].access_token}`); return Promise.resolve(actor ? Response.json({ id: actor, aud: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: stamp }) : Response.json({ message: 'Synthetic unauthorized' }, { status: 401 })); }
  return emulator.fetch(request);
 } } });
 const result = await backend.api.auth.setSession(sessions[owner]); expect(result.error).toBeNull(); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks(); });
afterAll(async () => db?.close());
it('retains normal verified-owner creation through the actual SDK and RLS', async () => {
 render(); submit(); const mutation = clients.get(owner)!.getMutationCache().getAll()[0]; await vi.waitFor(() => expect(mutation.state.status).toBe('success'));
 expect((await db.query<{ user_id: string; title: string }>('select user_id,title from inbox_items')).rows).toEqual([{ user_id: owner, title }]);
});
it('cannot move an old intent into a newly verified owner after its scope is replaced', async () => {
 let release!: () => void, began!: () => void; const held = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { began = resolve; });
 const actualVerify = backend.api!.auth.getUser.bind(backend.api!.auth);
 vi.spyOn(backend.api!.auth, 'getUser').mockImplementationOnce(async () => { began(); await held; return actualVerify(); });
 render(); submit(); await started; const mutation = clients.get(owner)!.getMutationCache().getAll()[0];
 expect((await backend.api!.auth.setSession(sessions[other])).error).toBeNull(); render(other); release();
 await vi.waitFor(() => expect(mutation.state.status).not.toBe('pending'));
 expect((await db.query<{ user_id: string; title: string }>('select user_id,title from inbox_items')).rows).toEqual([]);
});
it('refuses a different verified SDK actor even while the original server scope remains mounted', async () => {
 expect((await backend.api!.auth.setSession(sessions[other])).error).toBeNull(); render(); submit(); const mutation = clients.get(owner)!.getMutationCache().getAll()[0];
 await vi.waitFor(() => expect(mutation.state.status).toBe('error'));
 expect((await db.query<{ count: number }>('select count(*)::integer count from inbox_items')).rows[0].count).toBe(0);
});
