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
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    mounted.current = true;
    const pendingRequests = requests.current;
    return () => { mounted.current = false; for (const request of pendingRequests.values()) request.abort(); };
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
