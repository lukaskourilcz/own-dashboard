// @vitest-environment happy-dom
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { OwnerSessionBoundary } from '@/components/owner-session-boundary';
import { OwnerPreferencesProvider, useOwnerPreferences } from '@/lib/owner-preferences';
import { fetchNotes } from '@/lib/queries/fetchers';
import { common } from '@/lib/i18n/sections/common';
import type { Note } from '@/lib/types';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { SupabaseEmulator } from '../helpers/supabase-emulator';
const backend = vi.hoisted(() => ({ api: null as unknown as SupabaseClient }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => backend.api }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ common: common.en }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222', origin = 'https://example.supabase.co', stamp = '2026-10-25T12:00:00Z';
const user = (id: string): User => ({ id, aud: 'authenticated', role: 'authenticated', email: 'synthetic@example.test', app_metadata: {}, user_metadata: {}, created_at: stamp });
const session = (id: string) => {
 const expires_at = Math.floor(Date.now() / 1000) + 3600;
 const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
 return { access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: id, role: 'authenticated', exp: expires_at })}.${encode('synthetic-only-signature')}`, refresh_token: 'TEST-ONLY-refresh', expires_in: 3600, expires_at, token_type: 'bearer', user: user(id) };
};
const initial: Note = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, title: 'Original private note', content: [], plain_text: '', tags: [], is_pinned: false, sort_order: 0, created_at: stamp, updated_at: stamp };
let db: PGlite, root: Root, host: HTMLDivElement, client: QueryClient, ownerSignal: AbortSignal, authCalls: number, reads: number;
let first: ReturnType<typeof session>, second: ReturnType<typeof session>;
beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: stamp }); await db.query('insert into auth.users(id) values($1)', [other]); await db.query('insert into notes(id,user_id,title) values($1,$2,$3),($4,$5,$6)', [initial.id, owner, initial.title, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', other, 'Foreign private note']); }, 60_000);
beforeEach(async () => {
 vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', origin); vi.stubGlobal('BroadcastChannel', undefined); authCalls = 0; reads = 0;
 first = session(owner); second = session(other);
 const emulator = new SupabaseEmulator(db, origin, { service: 'TEST-ONLY-service', users: { [owner]: first.access_token, [other]: second.access_token } }, () => new Date(stamp));
 vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init), url = new URL(request.url);
  if (url.pathname === '/auth/v1/user') { authCalls++; const bearer = request.headers.get('authorization'); return Response.json(user(bearer === `Bearer ${second.access_token}` ? other : owner)); }
  if (url.pathname === '/rest/v1/notes') reads++;
  return emulator.fetch(request);
 }));
 backend.api = createBrowserClient(origin, 'TEST-ONLY-public', { isSingleton: false, auth: { autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: (input, init) => window.fetch(input, init) } });
 const signed = await backend.api.auth.setSession(first); if (signed.error) throw signed.error;
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(async () => { act(() => root.unmount()); host.remove(); client.clear(); await backend.api.auth.stopAutoRefresh(); for (const cookie of document.cookie.split(';')) document.cookie = `${cookie.split('=')[0].trim()}=; Path=/; Max-Age=0`; vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(async () => { await db?.close(); });
function Content() {
 const scope = useOwnerPreferences(); useEffect(() => { ownerSignal = scope!.capture().signal; }, [scope]);
 const notes = useQuery({ queryKey: ['legacy-cookie-notes'], queryFn: fetchNotes, enabled: false, initialData: [initial] });
 return <section><p>{notes.data?.[0]?.title}</p><input aria-label="Draft" defaultValue="Retained draft" /><button onClick={() => void notes.refetch()}>Read notes</button></section>;
}
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); }
it('retires before a real SDK legacy read can cross an unannounced HTTP cookie replacement', async () => {
 act(() => root.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><OwnerSessionBoundary enabled><Content /></OwnerSessionBoundary></OwnerPreferencesProvider></QueryClientProvider>));
 await flush(); expect(host.textContent).toContain(initial.title); expect(ownerSignal.aborted).toBe(false);
 const baselineAuth = authCalls;
 // Emulate a same-origin HTTP Set-Cookie response without any SDK sign-in event.
 document.cookie = `sb-example-auth-token=base64-${Buffer.from(JSON.stringify(second)).toString('base64url')}; Path=/; SameSite=Lax`;
 await flush(); expect(host.textContent).toContain(initial.title); expect(ownerSignal.aborted).toBe(false);
 act(() => (host.querySelector('button') as HTMLButtonElement).click());
 await vi.waitFor(async () => { await flush(); expect(host.textContent!.includes(common.en.sessionChanged) || host.textContent!.includes('Foreign private note')).toBe(true); });
 expect(host.textContent).toContain(common.en.sessionChanged);
 expect(host.textContent).not.toContain('Foreign private note'); expect(host.querySelector('input')).toBeNull(); expect(ownerSignal.aborted).toBe(true);
 expect(client.getQueryCache().getAll()).toHaveLength(0); expect(reads).toBe(0); expect(authCalls).toBe(baselineAuth);
});

it('keeps same-owner cookie refreshes, drafts and an actual SDK/RLS read without another verification', async () => {
 act(() => root.render(<QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><OwnerSessionBoundary enabled><Content /></OwnerSessionBoundary></OwnerPreferencesProvider></QueryClientProvider>));
 await flush(); const field = host.querySelector('input')!; field.value = 'Still my draft'; const baselineAuth = authCalls;
 const refreshed = { ...session(owner), user: { ...user(owner), user_metadata: { sub: other } } };
 document.cookie = `sb-example-auth-token=base64-${Buffer.from(JSON.stringify(refreshed)).toString('base64url')}; Path=/; SameSite=Lax`;
 await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 20)); });
 expect(host.textContent).toContain(initial.title); expect(host.querySelector('input')).toBe(field); expect(field.value).toBe('Still my draft');
 expect(ownerSignal.aborted).toBe(false); expect(reads).toBe(1); expect(authCalls).toBe(baselineAuth);
});
