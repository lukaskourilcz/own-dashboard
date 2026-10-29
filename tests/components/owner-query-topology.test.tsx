// @vitest-environment happy-dom
import { act, StrictMode, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { OwnerQueryProvider } from '@/components/owner-query-provider';
import { OwnerPreferencesProvider } from '@/lib/owner-preferences';
import { useEntityStore } from '@/lib/queries/entities';
import { qk } from '@/lib/queries/keys';
import type { Updater } from '@/lib/types';
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Row = { id: string; user_id: string; title: string };
const first = '11111111-1111-4111-8111-111111111111', second = '22222222-2222-4222-8222-222222222222';
const rows = (owner: string, title = owner === first ? 'Synthetic private A' : 'Synthetic private B'): Row[] => [{ id: owner, user_id: owner, title }];
let root: Root, host: HTMLDivElement, outer: QueryClient, setters: Map<string, Updater<Row[]>>, clients: Map<string, QueryClient>, pending: Promise<Row[]> | null, reads: number;
function View({ owner, tab }: { owner: string; tab: 'notes' | 'tools' }) {
 const client = useQueryClient();
 const [data, setData] = useEntityStore<Row[]>(tab === 'notes' ? qk.notes : qk.tools, pending && owner === first ? [] : rows(owner), async () => { reads++; return pending && owner === first ? pending : rows(owner); }, { seeded: !(pending && owner === first), enabled: !!pending && owner === first });
 useLayoutEffect(() => { setters.set(owner, setData); clients.set(owner, client); });
 return <section data-owner={owner}><p>{data.map(row => row.title).join(',')}</p><input aria-label="Synthetic draft" defaultValue="Keep same-owner draft" /></section>;
}
// The real shell nests an owner cache inside its root and private-preference
// contexts. The shared store still uses the original legacy entity keys.
function render(owner = first, tab: 'notes' | 'tools' = 'notes') { act(() => root.render(<StrictMode><QueryClientProvider client={outer}><OwnerPreferencesProvider ownerId={owner}><OwnerQueryProvider ownerId={owner}><View owner={owner} tab={tab} /></OwnerQueryProvider></OwnerPreferencesProvider></QueryClientProvider></StrictMode>)); }
const settle = () => act(async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0)); });
beforeEach(() => { pending = null; reads = 0; setters = new Map(); clients = new Map(); outer = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 300_000 } } }); host = document.createElement('div'); document.body.appendChild(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); outer.clear(); });
it('does not adopt an unscoped outer cache over the server-owned seed', () => {
 outer.setQueryData(qk.notes, rows(second, 'Synthetic unscoped cache')); render(); expect(host.textContent).toContain('Synthetic private A'); expect(host.textContent).not.toContain('Synthetic unscoped cache'); expect(outer.getQueryData(qk.notes)).toEqual(rows(second, 'Synthetic unscoped cache'));
});
it('isolates legacy entity keys when the server-verified owner prop changes', () => {
 render(); expect(host.textContent).toContain('Synthetic private A'); render(second); expect(host.textContent).toContain('Synthetic private B'); expect(host.textContent).not.toContain('Synthetic private A'); expect(clients.get(first)).not.toBe(clients.get(second));
});
it('cannot apply an old owned setter into the next owner cache', async () => {
 render(); const old = setters.get(first)!; render(second); act(() => old(rows(first, 'Late synthetic A update'))); await settle(); expect(host.textContent).toContain('Synthetic private B'); expect(host.textContent).not.toContain('Late synthetic A update');
});
it('does not consume an old uncooperative query as the new owner collection', async () => {
 let finish!: (value: Row[]) => void; pending = new Promise(resolve => { finish = resolve; }); render(); await settle(); expect(reads).toBeGreaterThan(0); render(second); await act(async () => finish(rows(first, 'Late synthetic A read'))); await settle(); expect(host.textContent).toContain('Synthetic private B'); expect(host.textContent).not.toContain('Late synthetic A read');
});
it('keeps same-owner updates and navigation in one cache without new collection reads', async () => {
 render(); const field = host.querySelector('input')!; field.value = 'Edited same-owner draft'; const client = clients.get(first); act(() => setters.get(first)!(rows(first, 'Confirmed same-owner edit'))); await settle(); render(); expect(host.querySelector('input')).toBe(field); expect(field.value).toBe('Edited same-owner draft'); expect(host.textContent).toContain('Confirmed same-owner edit');
 render(first, 'tools'); render(first, 'notes'); await settle(); expect(clients.get(first)).toBe(client); expect(host.textContent).toContain('Confirmed same-owner edit'); expect(reads).toBe(0);
});
it('clears only the retired private client while preserving root/public state', async () => {
 outer.setQueryData(['public-metadata'], ['Synthetic public value']); render(); const privateClient = clients.get(first)!; expect(privateClient.getDefaultOptions().queries).toMatchObject({ retry: 1, refetchOnWindowFocus: false });
 act(() => root.render(null)); await settle(); expect(privateClient.getQueryCache().getAll()).toHaveLength(0); expect(outer.getQueryData(['public-metadata'])).toEqual(['Synthetic public value']);
});
