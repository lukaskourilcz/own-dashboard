// @vitest-environment happy-dom
import { act, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { OwnerSessionBoundary } from '@/components/owner-session-boundary';
import { OwnerPreferencesProvider, useOwnerPreferences } from '@/lib/owner-preferences';
import { common } from '@/lib/i18n/sections/common';
import { requestSignOut } from '@/lib/auth-actions';
const state = vi.hoisted(() => ({ lang: 'en' as 'en' | 'cs', callbacks: new Set<(event: string, session: unknown) => void>(), verify: vi.fn(), create: vi.fn(), captures: [] as AbortSignal[] }));
vi.mock('@/lib/i18n', () => ({ useDict: () => ({ common: common[state.lang] }) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => state.create() }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
let root: Root, container: HTMLDivElement, client: QueryClient, network: ReturnType<typeof vi.fn<typeof fetch>>;
function PrivateContent() {
 const owner = useOwnerPreferences(); useEffect(() => { state.captures.push(owner!.capture().signal); }, [owner]);
 const { data } = useQuery({ queryKey: ['synthetic-owner-data'], initialData: ['Synthetic private cache'], enabled: false });
 return <section><p>{data?.[0]}</p><input aria-label="Synthetic draft" defaultValue="Retained synthetic draft" /></section>;
}
function render(enabled = true) { act(() => root.render(<StrictMode><QueryClientProvider client={client}><OwnerPreferencesProvider ownerId={owner}><OwnerSessionBoundary enabled={enabled}><PrivateContent /></OwnerSessionBoundary></OwnerPreferencesProvider></QueryClientProvider></StrictMode>)); }
const emit = (event: string, id: string | null = owner) => act(() => { for (const callback of state.callbacks) callback(event, id ? { user: { id } } : null); });
beforeEach(() => {
 state.lang = 'en'; state.callbacks.clear(); state.captures = []; state.verify.mockReset().mockResolvedValue({ data: { user: { id: owner } }, error: null });
 state.create.mockReset().mockReturnValue({ auth: { getUser: state.verify, onAuthStateChange: (callback: (event: string, session: unknown) => void) => { state.callbacks.add(callback); return { data: { subscription: { unsubscribe: () => state.callbacks.delete(callback) } } }; } } });
 network = vi.fn<typeof fetch>().mockResolvedValue(new Response('synthetic')); vi.stubGlobal('fetch', network); vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://backend.example');
 container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { act(() => root.unmount()); container.remove(); client.clear(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
for (const lang of ['en', 'cs'] as const) {
 it(`${lang}: unmounts private data, retires actions and latches after a different session`, async () => {
  state.lang = lang; render(); const signal = state.captures.at(-1)!; expect(signal.aborted).toBe(false); expect(state.callbacks.size).toBe(1); expect(container.textContent).toContain('Synthetic private cache');
  emit('SIGNED_IN', other); expect(signal.aborted).toBe(true); expect(container.querySelector('section')).toBeNull(); expect(container.querySelector('[role="alert"]')?.textContent).toBe(common[lang].sessionChangedDescription); expect(client.getQueryCache().getAll()).toHaveLength(0); expect(state.callbacks.size).toBe(0);
  emit('SIGNED_IN', owner); act(() => client.setQueryData(['synthetic-owner-data'], ['Late hidden callback'])); expect(container.textContent).not.toContain('Late hidden callback');
  await expect(fetch('/api/export/full')).rejects.toMatchObject({ name: 'AbortError' }); await expect(fetch('https://backend.example/rest/v1/notes')).rejects.toMatchObject({ name: 'AbortError' }); expect(network).not.toHaveBeenCalled();
  await fetch('/brand/mark.svg'); expect(network).toHaveBeenCalledOnce();
 });
 it(`${lang}: preserves same-owner drafts, cache and requests across repeated events/language changes`, async () => {
  state.lang = lang; render(); const field = container.querySelector('input')!; field.value = 'Edited draft remains'; const signal = state.captures.at(-1)!;
  for (const event of ['INITIAL_SESSION', 'TOKEN_REFRESHED', 'SIGNED_IN', 'USER_UPDATED']) emit(event);
  state.lang = lang === 'en' ? 'cs' : 'en'; render(); expect(container.querySelector('input')).toBe(field); expect(field.value).toBe('Edited draft remains'); expect(signal.aborted).toBe(false); expect(client.getQueryData(['synthetic-owner-data'])).toEqual(['Synthetic private cache']); expect(state.verify).not.toHaveBeenCalled();
  await fetch('/api/synthetic-read'); expect(network).toHaveBeenCalledOnce();
 });
}
it('cancels in-flight protected requests and refuses later callbacks after sign-out', async () => {
 let active!: AbortSignal; network.mockImplementation(async (_input, init) => { active = init!.signal!; return new Promise((_resolve, reject) => active.addEventListener('abort', () => reject(new DOMException('Synthetic abort', 'AbortError')))); }); render();
 const pending = fetch('/api/synthetic-read'); const check = expect(pending).rejects.toMatchObject({ name: 'AbortError' }); expect(active.aborted).toBe(false); emit('SIGNED_OUT', null); await check; expect(active.aborted).toBe(true); expect(container.querySelector('section')).toBeNull();
});
it('does not subscribe, wrap fetch or clear the preview cache when disabled', () => {
 render(false); expect(state.create).not.toHaveBeenCalled(); expect(window.fetch).toBe(network); expect(container.textContent).toContain('Synthetic private cache'); expect(client.getQueryCache().getAll()).toHaveLength(1);
});
it('restores the previous fetch after ordinary unmount without clearing a future scope', () => {
 render(); const captured = window.fetch; expect(captured).not.toBe(network); act(() => root.render(null)); expect(state.callbacks.size).toBe(0); expect(window.fetch).toBe(network);
 client.setQueryData(['future-owner'], ['future data']); expect(client.getQueryData(['future-owner'])).toEqual(['future data']);
});
it('fails closed when client/subscription creation throws', () => {
 state.create.mockImplementation(() => { throw Error('PRIVATE TEST diagnostic'); }); render(); expect(container.querySelector('section')).toBeNull(); expect(container.textContent).not.toContain('PRIVATE TEST'); expect(container.querySelector('[role="alert"]')).not.toBeNull();
});

it('retires the sender workspace only after a confirmed normal HTTP sign-out', async () => {
 render(); const field = container.querySelector('input')!; field.value = 'Retained HTTP draft';
 network.mockResolvedValueOnce(Response.json({ ok: false }, { status: 503 })).mockResolvedValueOnce(Response.json({ ok: true }));
 await act(async () => { await expect(requestSignOut()).rejects.toThrow('Sign-out unconfirmed'); });
 expect(container.querySelector('input')).toBe(field); expect(field.value).toBe('Retained HTTP draft');
 await act(async () => { await requestSignOut(); });
 expect(container.querySelector('section')).toBeNull(); expect(client.getQueryCache().getAll()).toHaveLength(0);
 expect(network).toHaveBeenCalledTimes(2); expect(state.verify).not.toHaveBeenCalled();
});
