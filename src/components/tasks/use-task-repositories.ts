'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/toast';
import { useDict } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { awaitWithSignal } from '@/lib/abortable';
import { qk } from '@/lib/queries/keys';
import { setReposDisconnected, useReposQuery } from '@/lib/github-queries';
import { commitFile } from '@/lib/github';
import { readOwnedCollection } from '@/lib/owned-records';
import { consumeRepositoryRecords } from '@/lib/repository-records';
import { syncNeededTasks } from '@/lib/needed-task-store';
import { diffNeededTodos, removeFinishedFromNeeded, scanNeededRepos } from '@/lib/needed-sync';
import { captureTaskWrite } from '@/lib/task-write';
import type { Todo } from '@/lib/types';

const names = (values: string[]) => values.slice(0, 3).join(', ') + (values.length > 3 ? ` +${values.length - 3}` : '');
type Operation = { owner: string; controller: AbortController };

/** One captured repository operation, including its confirmation, at a time. */
export function useTaskRepositories(ownerId: string, todos: Todo[], enabled: boolean) {
 const db = createClient(), client = useQueryClient(), confirm = useConfirmation(), toast = useToast(), t = useDict();
 const repos = useReposQuery(enabled);
 const mounted = useRef(false), actor = useRef(ownerId), rows = useRef(todos), operation = useRef<Operation | null>(null);
 const [pending, setPending] = useState<'refresh' | 'clear' | null>(null);
 useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.controller.abort(); }; }, []);
 useLayoutEffect(() => { actor.current = ownerId; operation.current?.controller.abort(); }, [ownerId]);
 useLayoutEffect(() => { rows.current = todos; }, [todos]);
 useUnsavedDraft({ dirty: false, get pending() { return operation.current !== null; }, canSave: false, save: async () => false });

 const current = (request: Operation) => mounted.current && actor.current === request.owner && !request.controller.signal.aborted;
 const invalidate = () => {
  void client.invalidateQueries({ queryKey: qk.todos, exact: true });
  void client.invalidateQueries({ queryKey: qk.dailyFocus });
 };
 async function run(kind: 'refresh' | 'clear', work: (request: Operation, signal: AbortSignal) => Promise<void>) {
  if (!mounted.current || !enabled || operation.current) return;
  if (!z.uuid().safeParse(actor.current).success) { toast.err(t.todos.refreshDisconnected); return; }
  const request = { owner: actor.current, controller: new AbortController() };
  operation.current = request; setPending(kind);
  const signal = AbortSignal.any([request.controller.signal, AbortSignal.timeout(90_000)]);
  try { await work(request, signal); }
  catch (error) {
   if (current(request)) {
    invalidate();
    const code = error instanceof Error ? error.message : '';
    toast.err(code === 'disconnected' ? t.todos.refreshDisconnected : code === 'no-repos' ? t.todos.refreshNoRepos : kind === 'refresh' ? t.todos.refreshErr : t.todos.clearFromNeededErr);
   }
  } finally {
   if (operation.current === request) { operation.current = null; if (mounted.current) setPending(null); }
  }
 }

 const refresh = () => run('refresh', async (request, signal) => {
  const refreshed = await awaitWithSignal(repos.refetch(), signal);
  if (!current(request)) return;
  const catalog = refreshed.data;
  if (refreshed.isError || !catalog || catalog.kind !== 'ok') throw Error(catalog?.kind === 'disconnected' ? 'disconnected' : 'no-repos');
  const { data: existing } = await readOwnedCollection(db, 'todos', request.owner, signal);
  if (!current(request)) return;
  const captured = structuredClone(existing);
  const scan = await scanNeededRepos(request.owner, catalog.repos, new Date().toISOString(), undefined, { signal });
  if (!current(request)) return;
  const obsolete = new Set(diffNeededTodos(scan.scanned, scan.freshRows, captured).toDeleteIds);
  const result = await syncNeededTasks(db, scan.freshRows, captured.filter(row => obsolete.has(row.id)), scan.scanned, signal);
  if (!current(request)) return;
  invalidate();
  const focus = await awaitWithSignal(fetch('/api/daily-focus', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]) }), signal).catch(() => null);
  if (!current(request)) return;
  if (result.added || result.removed) toast.ok(t.todos.refreshDone(result.added, result.removed));
  else if (!result.retained && !scan.missing.length && !scan.unavailable.length && !catalog.hasMore) toast.ok(t.todos.refreshNothing);
  if (catalog.hasMore) toast.info(t.todos.refreshRepoLimit(catalog.repos.length));
  if (result.retained) toast.info(t.todos.refreshRetained(result.retained));
  if (scan.unavailable.length) toast.info(t.todos.refreshUnavailable(names(scan.unavailable)));
  if (scan.missing.length) toast.info(t.todos.refreshMissing(names(scan.missing)));
  if (!focus?.ok) toast.err(t.todos.dailyFocusRefreshErr);
 });

 const clear = () => run('clear', async (request, signal) => {
  // Capture before confirmation, including all fields consumed by the SQL version check.
  const captured = rows.current.filter(row => row.done && row.source === 'github' && row.needed_raw?.trim() && row.repo_owner && row.repo_name).map(row => {
   const command = captureTaskWrite({ ownerId: request.owner, id: row.id, action: 'delete', expected: row, values: {} });
   return command.expected!;
  });
  if (!captured.length) return;
  const unchanged = () => {
   const latest = client.getQueryData<Todo[]>(qk.todos) ?? rows.current;
   return captured.every(expected => {
    const row = latest.find(value => value.id === expected.id);
    return row && Object.keys(expected).every(key => Object.is(row[key as keyof Todo], expected[key as keyof Todo]));
   });
  };
  const approved = await awaitWithSignal(confirm({ title: t.todos.clearFromNeeded, description: t.todos.clearFromNeededConfirm, confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true }), signal);
  if (!approved || !current(request)) return;
  if (!unchanged()) { toast.err(t.todos.taskChanged); invalidate(); return; }
  const result = await removeFinishedFromNeeded(captured, async (input, parent) => {
   if (!current(request) || !unchanged()) throw Error('Task source changed');
   return commitFile({ intent: 'edit', expectedSha: input.expectedSha, expectedRepositoryId: input.expectedRepositoryId, owner: input.owner, repo: input.repo, path: input.path, content: input.content, message: t.todos.finishedCommitMessage(input.count) }, parent);
  }, undefined, { signal });
  if (!current(request)) return;
  const eligible = new Set(result.cleared);
  try {
   const receipt = await consumeRepositoryRecords(db, 'todos', captured.filter(row => eligible.has(row.id)), signal);
   if (!current(request)) return;
   const kept = result.kept + receipt.retained.size;
   if (receipt.deleted.size) toast.ok(t.todos.clearFromNeededDone(receipt.deleted.size));
   else if (!kept && !result.disconnected) toast.info(t.todos.clearFromNeededNone);
   if (result.disconnected) { await setReposDisconnected(client, () => current(request)); if (current(request)) toast.err(t.todos.refreshDisconnected); }
   else if (kept) toast.err(t.todos.clearFromNeededIncomplete(kept));
   if (current(request) && result.missing.length) toast.info(t.todos.clearFromNeededMissing(names(result.missing)));
  } finally {
   if (current(request)) { invalidate(); void client.invalidateQueries({ queryKey: ['github', 'file'] }); }
  }
 });
 return { refresh, clear, pending, repositoriesPending: repos.isPending };
}
