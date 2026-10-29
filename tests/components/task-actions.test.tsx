// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Storage } from 'happy-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { NavigationGuardProvider, useGuardedNavigation } from '@/components/navigation-guard';
import { useTaskActions } from '@/components/tasks/use-task-actions';
import { qk } from '@/lib/queries/keys';
import { todos } from '@/lib/i18n/sections/todos';
import type { TaskWrite, TaskWriteReceipt } from '@/lib/task-write';
import type { Todo } from '@/lib/types';

const state = vi.hoisted(() => ({ write: vi.fn(), confirm: vi.fn(), err: vi.fn(), info: vi.fn(), navigate: vi.fn() }));
vi.mock('@/lib/task-write', async load => ({ ...await load<typeof import('@/lib/task-write')>(), writeTask: (...args: unknown[]) => state.write(...args) }));
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }));
vi.mock('@/components/ui/confirmation-dialog', () => ({ useConfirmation: () => state.confirm }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ err: state.err, info: state.info }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const row = (id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'): Todo => ({ id, user_id: owner, title: 'TEST_ONLY task', done: false, due_date: null, category: null, created_at: '2026-10-25T00:00:00.000000Z', updated_at: '2026-10-25T00:00:00.000001Z', source: null, repo_id: null, repo_full_name: null, repo_owner: null, repo_name: null, repo_url: null, needed_raw: null, needed_assignee: null, generated_at: null, importance: null, estimated_minutes: null, task_kind: null, is_global: false, project_id: null, organization_id: null, opportunity_id: null, job_application_id: null });
function receipt(command: TaskWrite): TaskWriteReceipt {
  if (command.action === 'create') throw Error('Not a creation fixture');
  return command.action === 'delete' ? { kind: 'deleted', ownerId: owner, id: command.id, task: null }
    : { kind: 'saved', ownerId: owner, id: command.id, task: { ...command.expected, done: command.values.done, updated_at: '2026-10-25T00:00:00.000002Z' } as Extract<TaskWriteReceipt, { kind: 'saved' }>['task'] };
}
let host: HTMLDivElement, root: Root, client: QueryClient, task: Todo, second: Todo, actor: string;
function Harness() {
  const actions = useTaskActions(actor), navigate = useGuardedNavigation();
  return <><button onClick={() => actions.toggle(task)} disabled={actions.pendingIds.has(task.id)}>toggle</button><button onClick={() => actions.remove(task)} disabled={actions.pendingIds.has(task.id)}>delete</button><button onClick={() => actions.toggle(second)}>other</button><button onClick={() => navigate(state.navigate)}>leave</button></>;
}
const button = (text: string) => [...host.querySelectorAll('button')].find(element => element.textContent === text)!;
const render = () => act(async () => { root.render(<QueryClientProvider client={client}><NavigationGuardProvider><Harness /></NavigationGuardProvider></QueryClientProvider>); });
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
beforeEach(async () => {
  vi.clearAllMocks(); const storage = new Storage(); storage.setItem('lang', 'en'); vi.stubGlobal('localStorage', storage); document.documentElement.lang = 'en';
  actor = owner; task = row(); second = row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); client.setQueryData(qk.todos, [task, second]);
  state.confirm.mockResolvedValue(true); state.write.mockImplementation(async (_db: unknown, command: TaskWrite) => receipt(command)); await render();
});
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); vi.unstubAllGlobals(); document.documentElement.lang = 'cs'; });

it('reserves a row synchronously, confirms no optimistic changes and allows unrelated work', async () => {
  let resolve!: (value: TaskWriteReceipt) => void; state.write.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  act(() => { button('toggle').click(); button('toggle').click(); button('delete').click(); }); expect(state.write).toHaveBeenCalledTimes(1); expect(state.confirm).not.toHaveBeenCalled(); expect(button('toggle').disabled).toBe(true); expect(client.getQueryData(qk.todos)).toEqual([task, second]);
  act(() => button('other').click()); await settle(); expect(client.getQueryData<Todo[]>(qk.todos)?.[1].done).toBe(true);
  await act(async () => resolve(receipt(state.write.mock.calls[0][1]))); await settle(); expect(client.getQueryData<Todo[]>(qk.todos)?.every(row => row.done)).toBe(true);
});
it('captures deletion before the confirmation await and refuses a changed source', async () => {
  let approve!: (value: boolean) => void; state.confirm.mockReturnValueOnce(new Promise(done => { approve = done; }));
  const captured = structuredClone(task); act(() => { button('delete').click(); button('delete').click(); }); expect(state.confirm).toHaveBeenCalledOnce(); expect(state.write).not.toHaveBeenCalled();
  task.title = 'Changed while confirming'; client.setQueryData(qk.todos, [task, second]);
  state.write.mockImplementationOnce(async (_db: unknown, command: TaskWrite) => ({ kind: 'conflict', ownerId: owner, id: command.id, task: null }));
  await act(async () => approve(true)); await settle(); expect(state.write.mock.calls[0][1].expected).toEqual(captured); expect(client.getQueryData(qk.todos)).toEqual([task, second]); expect(state.err).toHaveBeenCalledWith(todos.en.taskChanged);
});
it('cancelled confirmation releases the reservation without writing or changing cache', async () => {
  state.confirm.mockResolvedValueOnce(false); act(() => button('delete').click()); await settle(); expect(state.write).not.toHaveBeenCalled(); expect(button('toggle').disabled).toBe(false); expect(client.getQueryData(qk.todos)).toEqual([task, second]);
});
it('an unconfirmed write retains independent successes and never reveals private errors', async () => {
  let reject!: (error: Error) => void; state.write.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; })); act(() => button('toggle').click());
  act(() => button('other').click()); await settle(); await act(async () => reject(Error('TEST_ONLY_PRIVATE'))); await settle();
  const rows = client.getQueryData<Todo[]>(qk.todos)!; expect(rows[0].done).toBe(false); expect(rows[1].done).toBe(true); expect(state.err).toHaveBeenCalledWith(todos.en.saveErr); expect(host.textContent).not.toContain('TEST_ONLY_PRIVATE');
});
it('deletes only the unchanged captured row after a confirmed receipt', async () => {
  const invalidate = vi.spyOn(client, 'invalidateQueries'); act(() => button('delete').click()); await settle(); expect(client.getQueryData(qk.todos)).toEqual([second]); expect(invalidate).not.toHaveBeenCalledWith({ queryKey: qk.todos, exact: true });
});
it('does not overwrite a newer cached version with a late confirmed toggle', async () => {
  let resolve!: (value: TaskWriteReceipt) => void; state.write.mockReturnValueOnce(new Promise(done => { resolve = done; })); act(() => button('toggle').click());
  const newer = { ...task, title: 'Newer title', updated_at: '2026-10-25T00:00:00.000003Z' }; client.setQueryData(qk.todos, [newer, second]);
  await act(async () => resolve(receipt(state.write.mock.calls[0][1]))); await settle(); expect(client.getQueryData(qk.todos)).toEqual([newer, second]); expect(client.getQueryState(qk.todos)?.isInvalidated).toBe(true);
});
it('cancels an older real query before it can overwrite a confirmed toggle', async () => {
  let finish!: (rows: Todo[]) => void; let aborted = false;
  const read = client.fetchQuery({ queryKey: qk.todos, queryFn: ({ signal }) => { signal.addEventListener('abort', () => { aborted = true; }); return new Promise<Todo[]>(resolve => { finish = resolve; }); } }).catch(() => undefined);
  act(() => button('toggle').click()); await settle(); expect(aborted).toBe(true); finish([task, second]); await read; await settle(); expect(client.getQueryData<Todo[]>(qk.todos)?.[0].done).toBe(true);
});
it('distinguishes confirmed absence from an unavailable write', async () => {
  state.write.mockImplementationOnce(async (_db: unknown, command: TaskWrite) => ({ kind: 'absent', ownerId: owner, id: command.id, task: null })); act(() => button('toggle').click()); await settle(); expect(client.getQueryData(qk.todos)).toEqual([second]); expect(state.info).toHaveBeenCalledWith(todos.en.taskMissing); expect(state.err).not.toHaveBeenCalled();
});
it('blocks same-frame navigation while a write is pending and resumes after settlement', async () => {
  let resolve!: (value: TaskWriteReceipt) => void; state.write.mockReturnValueOnce(new Promise(done => { resolve = done; })); act(() => { button('toggle').click(); button('leave').click(); }); expect(state.navigate).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await act(async () => resolve(receipt(state.write.mock.calls[0][1]))); await settle(); expect(state.navigate).toHaveBeenCalledOnce();
});
it('does not write an old confirmation after the account changes', async () => {
  let approve!: (value: boolean) => void; state.confirm.mockReturnValueOnce(new Promise(done => { approve = done; })); act(() => button('delete').click()); actor = other; await render(); await act(async () => approve(true)); await settle(); expect(state.write).not.toHaveBeenCalled(); expect(state.err).not.toHaveBeenCalled();
});
it('aborts an in-flight action after owner change and ignores its late receipt', async () => {
  let resolve!: (value: TaskWriteReceipt) => void; state.write.mockReturnValueOnce(new Promise(done => { resolve = done; })); act(() => button('toggle').click()); actor = other; await render(); expect(state.write.mock.calls[0][2].aborted).toBe(true);
  await act(async () => resolve(receipt(state.write.mock.calls[0][1]))); await settle(); expect(client.getQueryData(qk.todos)).toEqual([task, second]); expect(state.err).not.toHaveBeenCalled();
});
it('aborts on unmount and ignores late deletion callbacks', async () => {
  let resolve!: (value: TaskWriteReceipt) => void; state.write.mockReturnValueOnce(new Promise(done => { resolve = done; })); act(() => button('delete').click()); await settle(); const command = state.write.mock.calls[0][1]; act(() => root.unmount()); expect(state.write.mock.calls[0][2].aborted).toBe(true);
  await act(async () => resolve(receipt(command))); expect(client.getQueryData(qk.todos)).toEqual([task, second]); root = createRoot(host); await render();
});
it('refuses an owner mismatch or legacy task without a version before any write', async () => {
  task = { ...task, user_id: other }; act(() => button('toggle').click()); await settle(); expect(state.write).not.toHaveBeenCalled(); expect(state.err).toHaveBeenCalledWith(todos.en.saveErr);
  task = row(); delete task.updated_at; act(() => button('delete').click()); await settle(); expect(state.confirm).not.toHaveBeenCalled(); expect(state.write).not.toHaveBeenCalled();
});
