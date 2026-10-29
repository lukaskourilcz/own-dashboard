'use client';

import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { createClient } from '@/lib/supabase/client';
import { useDict } from '@/lib/i18n';
import { qk } from '@/lib/queries/keys';
import { awaitWithSignal } from '@/lib/abortable';
import { applyCompetitorReceipt, createCompetitorRecord, updateCompetitorRecord, removeCompetitorRecord, CompetitorRecordError, type CompetitorFields, type CompetitorPatch, type CompetitorScope } from '@/lib/competitor-records';
import type { Competitor, Updater } from '@/lib/types';

type Save = { source: Competitor; fields: CompetitorPatch } | { source: null; id: string; fields: CompetitorFields };
export type CompetitionNotice = 'competitorChanged' | 'competitorActionUnconfirmed';

/** Both Competition surfaces share one owner/panel lifetime and row reservation.
 * Human confirmation does not change the version captured before opening it. */
export function useCompetitorActions(setCompetitors: Updater<Competitor[]>, rows: Competitor[]) {
 const owner = useOwnerPreferences(), db = createClient(), qc = useQueryClient(), confirm = useConfirmation(), t = useDict();
 const lifetime = useRef(new AbortController());
 useLayoutEffect(() => { if (lifetime.current.signal.aborted) lifetime.current = new AbortController(); return () => lifetime.current.abort(); }, []);
 const newControl = useRef<HTMLButtonElement | null>(null), deleteControls = useRef(new Map<string, HTMLButtonElement>());
 const focusRemoval = useRef<{ source: Competitor; nextId?: string } | null>(null);
 const registerNewControl = useCallback((button: HTMLButtonElement | null) => { newControl.current = button; }, []);
 const reservations = useRef(new Map<string, CompetitorScope>());
 const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
 useLayoutEffect(() => {
  const intent = focusRemoval.current;
  if (!intent || pending.has(intent.source.id)) return;
  const current = rows.find(row => row.id === intent.source.id);
  if (current) {
   // React Query can notify after pending state clears. Wait for the confirmed
   // cache removal; a changed cached source cancels this focus intent instead.
   if (applyCompetitorReceipt([current], intent.source, null).length > 0) focusRemoval.current = null;
   return;
  }
  focusRemoval.current = null;
  const next = intent.nextId ? deleteControls.current.get(intent.nextId) : null;
  const control = next && !next.disabled ? next : [...deleteControls.current.values()].find(button => !button.disabled) ?? newControl.current;
  control?.focus();
 }, [rows, pending]);
 const deleteControl = (id: string, button: HTMLButtonElement | null) => { if (button) deleteControls.current.set(id, button); else deleteControls.current.delete(id); };
 const [notice, setNotice] = useState<CompetitionNotice | null>(null);
 const [reloading, setReloading] = useState(false), [reloadFailed, setReloadFailed] = useState(false);
 const reloadingRef = useRef(false);
 const queryKey = useMemo(() => [...qk.competitors, owner?.ownerId], [owner?.ownerId]);
 const capture = (): CompetitorScope | null => {
  if (!owner) return null;
  const captured = owner.capture();
  return { ownerId: captured.ownerId, signal: AbortSignal.any([captured.signal, lifetime.current.signal]) };
 };
 function reserve(id: string) {
  if (reservations.current.has(id)) return null;
  const scope = capture(); if (!scope || scope.signal.aborted) return null;
  reservations.current.set(id, scope); setPending(new Set(reservations.current.keys())); return scope;
 }
 function release(id: string, scope: CompetitorScope) {
  if (reservations.current.get(id) !== scope) return;
  reservations.current.delete(id); if (!scope.signal.aborted) setPending(new Set(reservations.current.keys()));
 }
 async function apply(scope: CompetitorScope, source: Competitor | null, receipt: Competitor) {
  await awaitWithSignal(qc.cancelQueries({ queryKey, exact: true }), scope.signal); scope.signal.throwIfAborted();
  setCompetitors(rows => source ? applyCompetitorReceipt(rows, source, receipt) : rows.some(row => row.id === receipt.id) ? rows : [...rows, receipt]);
  void qc.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
 }
 async function save(intent: Save) {
  const id = intent.source ? intent.source.id : intent.id, scope = reserve(id);
  if (!scope) throw new CompetitorRecordError();
  try {
   const receipt = intent.source ? await updateCompetitorRecord(db, scope, intent.source, intent.fields) : await createCompetitorRecord(db, scope, intent.id, intent.fields);
   scope.signal.throwIfAborted(); await apply(scope, intent.source, receipt); setNotice(null); return receipt;
  } catch (error) {
   if (intent.source && !scope.signal.aborted) setNotice(error instanceof CompetitorRecordError && error.reason === 'changed' ? 'competitorChanged' : 'competitorActionUnconfirmed');
   throw error;
  } finally { release(id, scope); }
 }
 async function remove(row: Competitor) {
  const source = structuredClone(row), scope = reserve(source.id); if (!scope) return;
  try {
   if (source.user_id !== scope.ownerId) throw new CompetitorRecordError();
   if (!await confirm({ title: t.portfolio.deleteCompetitor, description: t.portfolio.deleteCompetitorConfirm, confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true })) return;
   scope.signal.throwIfAborted(); await removeCompetitorRecord(db, scope, source); scope.signal.throwIfAborted();
   await awaitWithSignal(qc.cancelQueries({ queryKey, exact: true }), scope.signal); scope.signal.throwIfAborted();
   const order = [...deleteControls.current.keys()];
   focusRemoval.current = { source, nextId: order[order.indexOf(source.id) + 1] };
   setCompetitors(rows => applyCompetitorReceipt(rows, source, null)); setNotice(null); void qc.invalidateQueries({ queryKey, exact: true, refetchType: 'none' });
  } catch (error) {
   if (!scope.signal.aborted) setNotice(error instanceof CompetitorRecordError && error.reason === 'changed' ? 'competitorChanged' : 'competitorActionUnconfirmed');
  } finally { release(source.id, scope); }
 }
 async function reload() {
  if (reloadingRef.current) return;
  const scope = capture(); if (!scope || scope.signal.aborted) return;
  reloadingRef.current = true; setReloading(true);
  try {
   await qc.refetchQueries({ queryKey, exact: true }, { throwOnError: true });
   if (!scope.signal.aborted && qc.getQueryState(queryKey)?.status === 'success') { setNotice(null); setReloadFailed(false); }
  } catch { if (!scope.signal.aborted) setReloadFailed(true); }
  finally { reloadingRef.current = false; if (!scope.signal.aborted) setReloading(false); }
 }
 useUnsavedDraft({ dirty: false, pending: pending.size > 0, canSave: false, save: async () => false });
 return { save, remove, pending, notice, reload, reloading, reloadFailed, registerNewControl, deleteControl };
}
export type CompetitorActions = ReturnType<typeof useCompetitorActions>;
