'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { useToast } from '@/components/ui/toast';
import { useDict } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { qk } from '@/lib/queries/keys';
import { applyTaskWriteReceipt, captureTaskWrite, writeTask, type TaskWrite } from '@/lib/task-write';
import type { Todo } from '@/lib/types';

/** Reserve each row before confirmation; apply only confirmed, captured-version changes. */
export function useTaskActions(ownerId: string) {
  const client = useQueryClient(), db = createClient(), confirm = useConfirmation(), toast = useToast(), t = useDict();
  const mounted = useRef(false), actor = useRef(ownerId), requests = useRef(new Map<string, AbortController>());
  const focusFrames = useRef(new Set<number>());
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    mounted.current = true;
    const pendingRequests = requests.current;
    const frames = focusFrames.current;
    return () => { mounted.current = false; for (const request of pendingRequests.values()) request.abort(); for (const frame of frames) cancelAnimationFrame(frame); frames.clear(); };
  }, []);
  useLayoutEffect(() => {
    actor.current = ownerId;
    for (const request of requests.current.values()) request.abort();
  }, [ownerId]);
  useUnsavedDraft({ dirty: false, get pending() { return requests.current.size > 0; }, canSave: false, save: async () => false });

  async function run(task: Todo, action: 'toggle' | 'delete') {
    if (!mounted.current || requests.current.has(task.id)) return;
    let command: TaskWrite;
    try {
      command = captureTaskWrite(action === 'toggle'
        ? { ownerId: actor.current, id: task.id, action, expected: task, values: { done: !task.done } }
        : { ownerId: actor.current, id: task.id, action, expected: task, values: {} });
    } catch {
      toast.err(t.todos.saveErr);
      void client.invalidateQueries({ queryKey: qk.todos, exact: true });
      return;
    }
    const cancellation = new AbortController();
    const initiator = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const sourceRow = initiator?.closest<HTMLElement>('[data-task-id]');
    const rendered = [...document.querySelectorAll<HTMLElement>('[data-task-id]')];
    const position = sourceRow ? rendered.indexOf(sourceRow) : -1;
    const neighbors = position < 0 ? [] : [...rendered.slice(position + 1), ...rendered.slice(0, position).reverse()].map(row => row.dataset.taskId);
    requests.current.set(command.id, cancellation); setPendingIds(new Set(requests.current.keys()));
    const current = () => mounted.current && actor.current === command.ownerId && !cancellation.signal.aborted;
    try {
      if (action === 'delete' && !await confirm({ title: t.common.delete, description: t.todos.deleteTaskConfirm, confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true })) return;
      if (!current()) return;
      const receipt = await writeTask(db, command, cancellation.signal);
      if (!current()) return;
      if (receipt.kind === 'conflict') {
        toast.err(t.todos.taskChanged);
        void client.invalidateQueries({ queryKey: qk.todos, exact: true });
        return;
      }
      await client.cancelQueries({ queryKey: qk.todos, exact: true });
      if (!current()) return;
      let reconcile = false;
      client.setQueryData<Todo[]>(qk.todos, rows => {
        if (!rows) { reconcile = true; return rows; }
        const applied = applyTaskWriteReceipt(rows, command, receipt); reconcile = applied.reconcile; return applied.rows;
      });
      if (reconcile) void client.invalidateQueries({ queryKey: qk.todos, exact: true });
      if (sourceRow && initiator) {
        const frame = requestAnimationFrame(() => {
          focusFrames.current.delete(frame);
          if (!current() || initiator.isConnected || document.activeElement !== document.body) return;
          const rows = [...document.querySelectorAll<HTMLElement>('[data-task-id]')];
          const target = neighbors.map(id => rows.find(row => row.dataset.taskId === id)?.querySelector<HTMLElement>('button:not(:disabled)')).find(element => element && element.getClientRects().length > 0)
            ?? document.querySelector<HTMLElement>('[data-task-focus-fallback]');
          target?.focus({ preventScroll: true });
        });
        focusFrames.current.add(frame);
      }
      void client.invalidateQueries({ queryKey: qk.dailyFocus });
      if (receipt.kind === 'absent') toast.info(t.todos.taskMissing);
    } catch {
      if (current()) {
        toast.err(t.todos.saveErr);
        void client.invalidateQueries({ queryKey: qk.todos, exact: true });
      }
    } finally {
      if (requests.current.get(command.id) === cancellation) requests.current.delete(command.id);
      if (mounted.current) setPendingIds(new Set(requests.current.keys()));
    }
  }
  return { pendingIds, toggle: (task: Todo) => { void run(task, 'toggle'); }, remove: (task: Todo) => { void run(task, 'delete'); } };
}
