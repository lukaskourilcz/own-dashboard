'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useGuardedNavigation, useUnsavedDraft } from '@/components/navigation-guard';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { awaitWithSignal } from '@/lib/abortable';
import { dneskaiSourceList } from '@/lib/i18n/sections/dneskai-source-list';
import { DNESKAI_SOURCE_LIMIT, DneskaiSourceActionSchema, dneskaiSourceLabel, sameDneskaiSourceRow, type DneskaiSourceAction, type DneskaiSourceList, type DneskaiSourceReceipt, type DneskaiSourceRefusalSchema, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
import { DneskaiSourceListError, postDneskaiSourceAction } from '@/lib/marketing/dneskai-source-list-client';
import type { z } from 'zod';

type Refusal = z.infer<typeof DneskaiSourceRefusalSchema>;
export type SourceActionResult = { kind: 'confirmed'; receipt: DneskaiSourceReceipt } | { kind: 'failed'; code: Refusal } | { kind: 'cancelled' };
type Origin = 'add' | 'edit' | 'list';
export type SourceNotice = { code: Refusal | 'saved' | 'removed'; sourceId: string; origin: Origin };

/** One mutation/confirmation at a time, scoped to one project and its cache. */
export function useSourceActions({ projectId, preview, queryKey, lang }: { projectId: string; preview: boolean; queryKey: QueryKey; lang: 'en' | 'cs' }) {
  const client = useQueryClient(), confirm = useConfirmation(), navigate = useGuardedNavigation();
  const operation = useRef<AbortController | null>(null), mounted = useRef(false);
  const [pending, setPending] = useState(false), [notice, setNotice] = useState<SourceNotice | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current?.abort(); }; }, []);
  useUnsavedDraft({ dirty: false, get pending() { return operation.current !== null; }, canSave: false, save: async () => false });

  async function run(value: DneskaiSourceAction, origin: Origin, ask = false): Promise<SourceActionResult> {
    if (operation.current || preview) return { kind: 'cancelled' };
    const controller = new AbortController(); operation.current = controller; setPending(true); setNotice(null);
    let attempted = false, applied = false;
    try {
      const action = DneskaiSourceActionSchema.parse(value), id = action.action === 'save' ? action.source.sourceId : action.sourceId;
      if (ask) {
        const t = dneskaiSourceList[lang];
        if (!await awaitWithSignal(confirm({ title: t.removeTitle(dneskaiSourceLabel(action.expected!)), description: t.removeDescription,
          confirmLabel: t.removeConfirm, cancelLabel: t.cancel, destructive: true }), controller.signal)) return { kind: 'cancelled' };
      }
      if (!mounted.current || controller.signal.aborted) return { kind: 'cancelled' };
      const snapshot = client.getQueryData<DneskaiSourceList>(queryKey), state = client.getQueryState(queryKey);
      if (!snapshot?.editable || state?.status === 'error') throw new DneskaiSourceListError('sources-unavailable');
      const current = snapshot.items.find(item => item.row.sourceId === id)?.row ?? null;
      if (!sameDneskaiSourceRow(current, action.expected)
        && !(action.action === 'save' ? sameDneskaiSourceRow(current, action.source) : current === null)) throw new DneskaiSourceListError('source-changed');
      attempted = true;
      const receipt = await postDneskaiSourceAction(action, controller.signal);
      if (!mounted.current || controller.signal.aborted) return { kind: 'cancelled' };
      if (receipt.kind === 'conflict') throw new DneskaiSourceListError('source-changed');
      // A read started before the commit must not later replace its receipt.
      await client.cancelQueries({ queryKey, exact: true }, { revert: false, silent: true });
      if (!mounted.current || controller.signal.aborted) return { kind: 'cancelled' };
      // This query disables structural sharing. A later complete read always
      // gets a different snapshot, even if its fields changed back to the old values.
      client.setQueryData<DneskaiSourceList>(queryKey, latest => {
        if (latest !== snapshot || client.getQueryState(queryKey)?.status === 'error') return latest;
        const index = latest.items.findIndex(item => item.row.sourceId === id);
        if (receipt.kind === 'saved') {
          if (index < 0 && latest.items.length >= DNESKAI_SOURCE_LIMIT) return latest;
          const item = index < 0 ? { row: receipt.source!, lastReadAt: null, lastItems: null, lastErrorCode: null }
            : { ...latest.items[index]!, row: receipt.source! };
          applied = true;
          return { ...latest, items: index < 0 ? [...latest.items, item] : latest.items.map((old, i) => i === index ? item : old) };
        }
        applied = true;
        return { ...latest, items: latest.items.filter(item => item.row.sourceId !== id) };
      });
      setNotice({ code: receipt.kind === 'removed' ? 'removed' : 'saved', sourceId: id, origin });
      return { kind: 'confirmed', receipt };
    } catch (error) {
      if (!mounted.current || controller.signal.aborted) return { kind: 'cancelled' };
      const code = error instanceof DneskaiSourceListError ? error.code : 'sources-unavailable';
      setNotice({ code, sourceId: value.action === 'save' ? value.source.sourceId : value.sourceId, origin });
      return { kind: 'failed', code };
    } finally {
      if (operation.current === controller) operation.current = null;
      if (mounted.current) setPending(false);
      if (attempted && !applied) void client.invalidateQueries({ queryKey, refetchType: mounted.current ? 'active' : 'none' });
    }
  }
  return { pending, notice, clearNotice: () => setNotice(null), isBusy: () => operation.current !== null,
    save: (source: DneskaiSourceRow, expected: DneskaiSourceRow | null, origin: Origin) => run({ action: 'save', projectId, source, expected }, origin),
    remove: (source: DneskaiSourceRow) => {
      // Reject a repeat before the navigation guard can queue and replay it.
      if (operation.current || preview) return;
      navigate(() => { void run({ action: 'remove', projectId, sourceId: source.sourceId, expected: source }, 'list', true); });
    },
  };
}
export type SourceActions = ReturnType<typeof useSourceActions>;
