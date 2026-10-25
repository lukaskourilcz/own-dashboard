// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Storage } from 'happy-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ProjectTraffic } from '@/components/projects/project-traffic';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { qk } from '@/lib/queries/keys';
import { professional } from '@/lib/i18n/sections/professional';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const ok = () => ({ kind: 'ok', projectId: 'prj_example', lifetime: { pageviews: 200, visitors: 120 }, last30: { pageviews: 100, visitors: 65 }, daily: [{ date: '2026-10-01', pageviews: 50, visitors: 40 }, { date: '2026-10-25', pageviews: 50, visitors: 40 }], window: { since: '2026-09-26', until: '2026-10-25' }, checkedAt: '2026-10-25T12:00:00Z' });
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); document.documentElement.lang = ''; vi.unstubAllGlobals(); });
const settle = () => new Promise(resolve => setTimeout(resolve, 30));
async function render(options: { lang?: 'en' | 'cs'; preview?: boolean; enabled?: boolean; ownerId?: string | null } = {}) {
 const identity = options.ownerId === undefined ? owner : options.ownerId;
 vi.stubGlobal('localStorage', new Storage()); document.documentElement.lang = options.lang ?? 'en';
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
 const content = <ProjectTraffic repoFullName="owner/repo" repoId={123} preview={options.preview} enabled={options.enabled} />;
 await act(async () => { root!.render(<QueryClientProvider client={client}>{identity ? <OwnerPreferencesProvider ownerId={identity}>{content}</OwnerPreferencesProvider> : content}</QueryClientProvider>); await settle(); });
 await act(settle);
}
it.each(['en', 'cs'] as const)('retains confirmed metrics on refresh failure, reports it once and retries (%s)', async lang => {
 let failed = false; const fetcher = vi.fn(async () => failed ? new Response(null, { status: 503 }) : Response.json({ ownerId: owner, traffic: ok() })); vi.stubGlobal('fetch', fetcher);
 await render({ lang }); expect(host.textContent).toContain(professional[lang].trafficLast30); expect(host.textContent).toContain('65'); expect(host.querySelector('[role="alert"]')).toBeNull();
 failed = true; await act(async () => { await client.refetchQueries({ queryKey: qk.projectTraffic }); await settle(); });
 expect(host.querySelectorAll('[role="alert"]')).toHaveLength(1); expect(host.textContent).toContain('65'); expect(host.textContent).toContain(professional[lang].trafficError);
 failed = false; await act(async () => { host.querySelector('button')!.click(); await settle(); }); await act(settle);
 expect(host.querySelector('[role="alert"]')).toBeNull(); expect(fetcher).toHaveBeenCalledTimes(3);
});
it.each(['en', 'cs'] as const)('does not invent zero totals on a cold error and recovers using Retry (%s)', async lang => {
 let failed = true; vi.stubGlobal('fetch', vi.fn(async () => failed ? new Response(null, { status: 503 }) : Response.json({ ownerId: owner, traffic: ok() })));
 await render({ lang }); expect(host.querySelector('[role="alert"]')).not.toBeNull(); expect(host.textContent).not.toContain(professional[lang].trafficLast30);
 failed = false; await act(async () => { host.querySelector('button')!.click(); await settle(); }); await act(settle); expect(host.querySelector('[role="alert"]')).toBeNull(); expect(host.textContent).toContain('65');
});
it.each([{ preview: true }, { enabled: false }, { ownerId: null }, { ownerId: 'malformed' }])('renders no forever-loading card or private request when inactive (%j)', async options => {
 const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher); await render(options); expect(fetcher).not.toHaveBeenCalled(); expect(host.textContent).toBe('');
});
it.each(['unconfigured', 'not-found'])('preserves %s state', async kind => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ownerId: owner, traffic: { kind } }))); await render();
 if (kind === 'unconfigured') expect(host.textContent).toBe(''); else expect(host.textContent).toContain(professional.en.trafficNotFound);
});
it('does not render another captured owner response', async () => {
 vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ownerId: other, traffic: ok() }))); await render(); expect(host.textContent).toContain(professional.en.trafficError); expect(host.textContent).not.toContain('65');
});
it('aborts a pending request when its owner scope unmounts', async () => {
 let signal: AbortSignal | undefined; vi.stubGlobal('fetch', vi.fn((_input, init) => { signal = init.signal; return new Promise<Response>(() => {}); })); await render();
 expect(signal?.aborted).toBe(false); await act(async () => { root!.unmount(); root = undefined; }); expect(signal?.aborted).toBe(true);
});
it('coalesces repeated retry clicks while one request is pending', async () => {
 let release!: (response: Response) => void; const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(() => new Promise<Response>(resolve => { release = resolve; })); vi.stubGlobal('fetch', fetcher);
 await render(); await act(async () => { const button = host.querySelector('button')!; button.click(); button.click(); await settle(); }); expect(fetcher).toHaveBeenCalledTimes(2); expect(host.textContent).toContain(professional.en.trafficLoading); expect(host.querySelector('button:not(:disabled)')).toBeNull();
 await act(async () => { release(Response.json({ ownerId: owner, traffic: ok() })); await settle(); }); await act(settle); expect(host.querySelector('[role="alert"]')).toBeNull();
});
