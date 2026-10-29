// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useTaskRepositories } from '@/components/tasks/use-task-repositories';
import { NavigationGuardProvider, useGuardedNavigation } from '@/components/navigation-guard';
import { qk } from '@/lib/queries/keys';
import { todos as strings } from '@/lib/i18n/sections/todos';
import { common } from '@/lib/i18n/sections/common';
import { task as fixtureTask, owner } from '../../e2e/task-fixtures';
import type { Todo } from '@/lib/types';

const state = vi.hoisted(() => ({ refetch: vi.fn(), read: vi.fn(), scan: vi.fn(), sync: vi.fn(), remove: vi.fn(), consume: vi.fn(), commit: vi.fn(), disconnect: vi.fn(), confirm: vi.fn(), ok: vi.fn(), info: vi.fn(), err: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/lib/github-queries', () => ({ useReposQuery: () => ({ refetch: state.refetch, isPending: false }), setReposDisconnected: (...args: unknown[]) => state.disconnect(...args) }));
vi.mock('@/lib/owned-records', () => ({ readOwnedCollection: (...args: unknown[]) => state.read(...args) }));
vi.mock('@/lib/needed-task-store', () => ({ syncNeededTasks: (...args: unknown[]) => state.sync(...args) }));
vi.mock('@/lib/repository-records', () => ({ consumeRepositoryRecords: (...args: unknown[]) => state.consume(...args) }));
vi.mock('@/lib/needed-sync', async original => ({ ...await original<typeof import('@/lib/needed-sync')>(), scanNeededRepos: (...args: unknown[]) => state.scan(...args), removeFinishedFromNeeded: (...args: unknown[]) => state.remove(...args) }));
vi.mock('@/lib/github', () => ({ commitFile: (...args: unknown[]) => state.commit(...args) }));
vi.mock('@/components/ui/confirmation-dialog', () => ({ useConfirmation: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ ok: state.ok, info: state.info, err: state.err }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement, client: QueryClient, rows: Todo[], actor: string, enabled: boolean;
const other = '22222222-2222-4222-8222-222222222222';
const task = (): Todo => ({ ...fixtureTask('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TEST_ONLY finished repository task'), done: true, source: 'github', repo_id: '123', repo_owner: 'owner', repo_name: 'fixture', repo_full_name: 'owner/fixture', needed_raw: '- [ ] Original', generated_at: '2026-10-25T00:00:00Z' });
const catalog = () => ({ data: { kind: 'ok', repos: [], hasMore: false }, isError: false });
function Harness() {
 const actions = useTaskRepositories(actor, rows, enabled), navigate = useGuardedNavigation();
 return <><button onClick={() => { void actions.refresh(); }}>refresh</button><button onClick={() => { void actions.clear(); }}>clear</button><button onClick={() => navigate(state.navigate)}>leave</button><output>{actions.pending ?? 'idle'}</output></>;
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent === text)!;
const render = () => act(async () => root.render(<QueryClientProvider client={client}><NavigationGuardProvider><Harness /></NavigationGuardProvider></QueryClientProvider>));
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
beforeEach(async () => {
 vi.clearAllMocks(); actor = owner; enabled = true; rows = [task()]; const storage = new Storage(); storage.setItem('lang', 'en'); vi.stubGlobal('localStorage', storage); document.documentElement.lang = 'en';
 host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(qk.todos, rows);
 state.refetch.mockResolvedValue(catalog()); state.read.mockImplementation(async () => ({ data: rows, error: null })); state.scan.mockResolvedValue({ scanned: new Set(), freshRows: [], missing: [], unavailable: [] });
 state.sync.mockResolvedValue({ added: 0, removed: 0, retained: 0 }); state.confirm.mockResolvedValue(true); state.remove.mockImplementation(async (captured: Todo[]) => ({ cleared: captured.map(row => row.id), missing: [], kept: 0, disconnected: false }));
 state.consume.mockImplementation(async (_db, _entity, captured: Todo[]) => ({ deleted: new Set(captured.map(row => row.id)), retained: new Set() })); state.commit.mockResolvedValue({ ok: true });
 vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 }))); await render();
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); document.documentElement.lang = 'cs'; });

it('reserves the operation before React renders and protects a same-frame exit', async () => {
 let release!: (value: ReturnType<typeof catalog>) => void; state.refetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
 act(() => { button('refresh').click(); button('refresh').click(); button('clear').click(); button('leave').click(); });
 expect(state.refetch).toHaveBeenCalledOnce(); expect(state.confirm).not.toHaveBeenCalled(); expect(state.navigate).not.toHaveBeenCalled();
 const dialog = document.querySelector('[role="dialog"]')!; expect(dialog.textContent).toContain(common.en.unsaved.pendingTitle);
 expect(button(common.en.unsaved.discard).disabled).toBe(true); act(() => button(common.en.unsaved.stay).click());
 await act(async () => release(catalog())); await settle(); expect(state.read.mock.calls[0][2]).toBe(owner); expect(state.sync).toHaveBeenCalledOnce(); expect(state.err).not.toHaveBeenCalled();
});
it('does not choose a later account after a held repository refresh', async () => {
 let release!: (value: ReturnType<typeof catalog>) => void; state.refetch.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
 act(() => button('refresh').click()); actor = other; await render(); await act(async () => release(catalog())); await settle();
 expect(state.read).not.toHaveBeenCalled(); expect(state.sync).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('aborts an owner read on unmount and ignores an uncooperative late read', async () => {
 let release!: (value: unknown) => void; state.read.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
 act(() => button('refresh').click()); await settle(); const signal = state.read.mock.calls[0][3] as AbortSignal;
 act(() => root.unmount()); expect(signal.aborted).toBe(true); await act(async () => release({ data: rows, error: null })); await settle();
 expect(state.scan).not.toHaveBeenCalled(); expect(state.ok).not.toHaveBeenCalled(); root = createRoot(host);
});
it('keeps private refresh errors out of notices and releases retry', async () => {
 state.refetch.mockRejectedValueOnce(new Error('TEST_ONLY_PRIVATE'));
 act(() => button('refresh').click()); await settle(); expect(state.err).toHaveBeenCalledWith(strings.en.refreshErr); expect(state.sync).not.toHaveBeenCalled();
 act(() => button('refresh').click()); await settle(); expect(state.sync).toHaveBeenCalledOnce(); expect(state.ok).toHaveBeenCalledWith(strings.en.refreshNothing);
});
it('reports the separate focus failure after a confirmed synchronization', async () => {
 state.sync.mockResolvedValueOnce({ added: 2, removed: 1, retained: 0 }); vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 503 }));
 act(() => button('refresh').click()); await settle(); expect(state.ok).toHaveBeenCalledWith(strings.en.refreshDone(2, 1)); expect(state.err).toHaveBeenCalledWith(strings.en.dailyFocusRefreshErr);
});
it('keeps incomplete repository reads distinct from an empty successful scan', async () => {
 state.refetch.mockResolvedValueOnce({ data: { kind: 'ok', repos: [], hasMore: true }, isError: false });
 state.scan.mockResolvedValueOnce({ scanned: new Set(), freshRows: [], missing: ['owner/missing'], unavailable: ['owner/offline'] });
 act(() => button('refresh').click()); await settle(); expect(state.ok).not.toHaveBeenCalled(); expect(state.info).toHaveBeenCalledWith(strings.en.refreshMissing('owner/missing')); expect(state.info).toHaveBeenCalledWith(strings.en.refreshUnavailable('owner/offline')); expect(state.info).toHaveBeenCalledWith(strings.en.refreshRepoLimit(0));
});
it('reserves cleanup before confirmation and allows cancellation without any source work', async () => {
 let answer!: (value: boolean) => void; state.confirm.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
 act(() => { button('clear').click(); button('clear').click(); button('refresh').click(); }); expect(state.confirm).toHaveBeenCalledOnce(); expect(state.refetch).not.toHaveBeenCalled();
 await act(async () => answer(false)); await settle(); expect(state.remove).not.toHaveBeenCalled(); expect(state.consume).not.toHaveBeenCalled();
 act(() => button('clear').click()); await settle(); expect(state.remove).toHaveBeenCalledOnce();
});
it('retains a task changed during confirmation before any external source commit', async () => {
 let answer!: (value: boolean) => void; state.confirm.mockReturnValueOnce(new Promise(resolve => { answer = resolve; }));
 act(() => button('clear').click()); client.setQueryData(qk.todos, [{ ...rows[0], done: false, updated_at: '2026-10-25T00:00:00.000002Z' }]);
 await act(async () => answer(true)); await settle(); expect(state.remove).not.toHaveBeenCalled(); expect(state.consume).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(strings.en.taskChanged);
});
it('rechecks a captured task immediately before a delayed repository commit', async () => {
 let commit!: () => Promise<unknown>, finish!: () => void;
 state.remove.mockImplementationOnce(async (_captured, callback) => { commit = () => callback({ owner: 'owner', repo: 'fixture', path: 'NEEDED.md', content: '', count: 1, expectedSha: 'a'.repeat(40), expectedRepositoryId: 123 }); await new Promise<void>(resolve => { finish = resolve; }); return { cleared: [], missing: [], kept: 1, disconnected: false }; });
 act(() => button('clear').click()); await settle(); client.setQueryData(qk.todos, [{ ...rows[0], done: false }]);
 await expect(commit()).rejects.toThrow('Task source changed'); expect(state.commit).not.toHaveBeenCalled(); expect(state.consume).not.toHaveBeenCalled();
 await act(async () => finish()); await settle(); expect(state.err).toHaveBeenCalledWith(strings.en.clearFromNeededIncomplete(1));
});
it('consumes only the versions confirmed in the captured cleanup batch', async () => {
 let release!: (value: unknown) => void; state.remove.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
 const original = structuredClone(rows[0]); act(() => button('clear').click()); await settle();
 const added = { ...task(), id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'Newer independent task' }; rows = [...rows, added]; client.setQueryData(qk.todos, rows); await render();
 await act(async () => release({ cleared: [original.id], missing: [], kept: 0, disconnected: false })); await settle();
 expect(state.consume.mock.calls[0][2]).toEqual([original]); expect(state.ok).toHaveBeenCalledWith(strings.en.clearFromNeededDone(1)); expect(client.getQueryData<Todo[]>(qk.todos)).toContainEqual(added);
});
it('retains a reopened source when the confirmed database partition refuses its removal', async () => {
 state.consume.mockResolvedValueOnce({ deleted: new Set(), retained: new Set([rows[0].id]) });
 act(() => button('clear').click()); await settle(); expect(state.ok).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(strings.en.clearFromNeededIncomplete(1)); expect(client.getQueryData(qk.todos)).toEqual(rows);
});
it('ignores late cleanup receipts after an account change', async () => {
 let release!: (value: unknown) => void; state.consume.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
 act(() => button('clear').click()); await settle(); const signal = state.consume.mock.calls[0][3] as AbortSignal;
 actor = other; await render(); expect(signal.aborted).toBe(true); await act(async () => release({ deleted: new Set([rows[0].id]), retained: new Set() })); await settle();
 expect(state.ok).not.toHaveBeenCalled(); expect(state.disconnect).not.toHaveBeenCalled();
});
it('does not falsely announce nothing-to-clear after a disconnected source receipt', async () => {
 state.remove.mockResolvedValueOnce({ cleared: [], missing: [], kept: 1, disconnected: true });
 act(() => button('clear').click()); await settle(); expect(state.disconnect).toHaveBeenCalledOnce(); expect(state.info).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(strings.en.refreshDisconnected);
});
it('never starts disabled compact-widget or malformed-owner repository work', async () => {
 enabled = false; await render(); act(() => { button('refresh').click(); button('clear').click(); }); expect(state.refetch).not.toHaveBeenCalled(); expect(state.confirm).not.toHaveBeenCalled();
 enabled = true; actor = 'preview-user'; await render(); act(() => button('clear').click()); expect(state.confirm).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(strings.en.refreshDisconnected);
});
