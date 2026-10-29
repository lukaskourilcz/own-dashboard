'use client';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { createClient } from '@/lib/supabase/client';
import { useDict } from '@/lib/i18n';
import { qk } from '@/lib/queries/keys';
import { awaitWithSignal } from '@/lib/abortable';
import { guestReadOnlyError, isGuestTour } from '@/lib/guest-requests';
import { applyPlanReceipt, createPlanRecord, updatePlanRecord, removePlanRecord, PlanRecordError, type PlanScope, type PlanFields, type PlanPatch } from '@/lib/plan-records';
import type { Plan, Updater } from '@/lib/types';

/** Goals and Home share confirmed row writes. Optional Calendar work follows a
 * confirmed plan only once, within the original owner/panel lifetime. */
export function usePlanActions(setPlans: Updater<Plan[]>, rows: Plan[]) {
 const owner = useOwnerPreferences(), db = createClient(), qc = useQueryClient(), confirm = useConfirmation(), t = useDict();
 const lifetime = useRef(new AbortController());
 useLayoutEffect(() => { if (lifetime.current.signal.aborted) lifetime.current = new AbortController(); return () => lifetime.current.abort(); }, []);
 const reservations = useRef(new Map<string, PlanScope>()), [pending, setPending] = useState<ReadonlySet<string>>(new Set());
 const [notice, setNotice] = useState<'changed' | 'unconfirmed' | null>(null);
 const [calendarNotice, setCalendarNotice] = useState<'calendarEventFailed' | 'calendarLinkFailed' | 'calendarDeleteFailed' | null>(null);
 const [reloading, setReloading] = useState(false), reloadPending = useRef(false);
 const actionControls = useRef(new Map<string, HTMLButtonElement>()), focusUpdate = useRef<Plan | null>(null);
 const actionControl = (id: string, button: HTMLButtonElement | null) => { if (button) actionControls.current.set(id, button); else actionControls.current.delete(id); };
 const newControl = useRef<HTMLButtonElement | null>(null), controls = useRef(new Map<string, HTMLButtonElement>()), focusRemoval = useRef<{ source: Plan; next?: string } | null>(null);
 const registerNewControl = useCallback((button: HTMLButtonElement | null) => { newControl.current = button; }, []);
 const deleteControl = (id: string, button: HTMLButtonElement | null) => { if (button) controls.current.set(id, button); else controls.current.delete(id); };
 useLayoutEffect(() => {
  const intent = focusRemoval.current; if (!intent || pending.has(intent.source.id)) return;
  const current = rows.find(row => row.id === intent.source.id);
  if (current) { if (applyPlanReceipt([current], intent.source, null).length) focusRemoval.current = null; return; }
  focusRemoval.current = null;
  const next = intent.next ? controls.current.get(intent.next) : null;
  (next && !next.disabled ? next : [...controls.current.values()].find(control => !control.disabled) ?? newControl.current)?.focus();
 }, [pending, rows]);
 useLayoutEffect(() => {
  const source = focusUpdate.current; if (!source || pending.has(source.id)) return;
  const current = rows.find(row => row.id === source.id);
  // React Query can notify after pending clears. Wait until the captured
  // source actually changes before restoring focus in a reordered/paged list.
  if (current && applyPlanReceipt([current], source, null).length === 0) return;
  focusUpdate.current = null;
  const target = actionControls.current.get(source.id);
  (target && !target.disabled ? target : [...actionControls.current.values()].find(control => !control.disabled) ?? newControl.current)?.focus();
 }, [pending, rows]);
 function capture(): PlanScope | null {
  if (!owner) return null;
  const captured = owner.capture(); return { ownerId: captured.ownerId, signal: AbortSignal.any([captured.signal, lifetime.current.signal]) };
 }
 function reserve(id: string) {
  if (reservations.current.has(id)) return null;
  const scope = capture(); if (!scope || scope.signal.aborted) return null;
  reservations.current.set(id, scope); setPending(new Set(reservations.current.keys())); return scope;
 }
 function release(id: string, scope: PlanScope) {
  if (reservations.current.get(id) !== scope) return;
  reservations.current.delete(id); if (!scope.signal.aborted) setPending(new Set(reservations.current.keys()));
 }
 async function apply(scope: PlanScope, source: Plan | null, receipt: Plan) {
  await awaitWithSignal(qc.cancelQueries({ queryKey: qk.plans, exact: true }), scope.signal); scope.signal.throwIfAborted();
  setPlans(current => source ? applyPlanReceipt(current, source, receipt) : current.some(row => row.id === receipt.id) ? current : [receipt, ...current]);
  void qc.invalidateQueries({ queryKey: qk.plans, exact: true, refetchType: 'none' });
 }
 const failed = (error: unknown) => setNotice(error instanceof PlanRecordError && error.reason === 'changed' ? 'changed' : 'unconfirmed');
 const invalidateCalendar = () => { for (const queryKey of [qk.calendarToday, qk.calendarWeek, qk.calendarLastWeek]) void qc.invalidateQueries({ queryKey }); };
 async function create(id: string, fields: PlanFields, addToCalendar: boolean) {
  if (isGuestTour()) { guestReadOnlyError(); throw new PlanRecordError(); }
  const intent = structuredClone(fields), scope = reserve(id); if (!scope) throw new PlanRecordError();
  try {
   const plan = await createPlanRecord(db, scope, id, intent); scope.signal.throwIfAborted(); await apply(scope, null, plan); setNotice(null); setCalendarNotice(null);
   if (!addToCalendar || !intent.target_date) return plan;
   let eventId: string;
   try {
    scope.signal.throwIfAborted();
    const { createOwnedCalendarEvent } = await awaitWithSignal(import('@/lib/calendar-event-client'), scope.signal);
    scope.signal.throwIfAborted();
    const event = await createOwnedCalendarEvent(scope, { title: intent.title, date: intent.target_date, allDay: true, description: intent.notes ?? '', recurrence: 'none' });
    scope.signal.throwIfAborted(); eventId = event.id;
   } catch {
    scope.signal.throwIfAborted(); setCalendarNotice('calendarEventFailed'); invalidateCalendar(); return plan;
   }
   try {
    scope.signal.throwIfAborted();
    const linked = await updatePlanRecord(db, scope, plan, { linked_calendar_event_id: eventId });
    await apply(scope, plan, linked); invalidateCalendar(); return linked;
   } catch {
    scope.signal.throwIfAborted(); setCalendarNotice('calendarLinkFailed'); invalidateCalendar(); return plan;
   }
  } finally { release(id, scope); }
 }
 async function update(row: Plan, patch: PlanPatch) {
  if (isGuestTour()) { guestReadOnlyError(); return; }
  const source = structuredClone(row), scope = reserve(source.id); if (!scope) return;
  try { const receipt = await updatePlanRecord(db, scope, source, patch); focusUpdate.current = source; await apply(scope, source, receipt); setNotice(null); }
  catch (error) { if (focusUpdate.current === source) focusUpdate.current = null; if (!scope.signal.aborted) failed(error); }
  finally { release(source.id, scope); }
 }
 async function remove(row: Plan) {
  if (isGuestTour()) { guestReadOnlyError(); return; }
  const source = structuredClone(row), scope = reserve(source.id); if (!scope) return;
  try {
   if (source.user_id !== scope.ownerId) throw new PlanRecordError();
   if (!await confirm({ title: t.common.delete, description: t.common.deletePermanentlyConfirm, confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true })) return;
   scope.signal.throwIfAborted(); await removePlanRecord(db, scope, source); scope.signal.throwIfAborted();
   await awaitWithSignal(qc.cancelQueries({ queryKey: qk.plans, exact: true }), scope.signal); scope.signal.throwIfAborted();
   const order = [...controls.current.keys()]; focusRemoval.current = { source, next: order[order.indexOf(source.id) + 1] };
   setPlans(current => applyPlanReceipt(current, source, null)); setNotice(null); setCalendarNotice(null);
   void qc.invalidateQueries({ queryKey: qk.plans, exact: true, refetchType: 'none' });
   if (source.linked_calendar_event_id) {
    try { const { deleteOwnedCalendarEvent } = await awaitWithSignal(import('@/lib/calendar-event-client'), scope.signal); scope.signal.throwIfAborted(); await deleteOwnedCalendarEvent(scope, source.linked_calendar_event_id); scope.signal.throwIfAborted(); }
    catch { scope.signal.throwIfAborted(); setCalendarNotice('calendarDeleteFailed'); }
    invalidateCalendar();
   }
  } catch (error) { if (!scope.signal.aborted) failed(error); }
  finally { release(source.id, scope); }
 }
 async function reload() {
  if (reloadPending.current || reservations.current.size > 0) return;
  const scope = capture(); if (!scope || scope.signal.aborted) return;
  reloadPending.current = true; setReloading(true);
  try { await awaitWithSignal(qc.refetchQueries({ queryKey: qk.plans, exact: true }, { throwOnError: true }), scope.signal); scope.signal.throwIfAborted(); setNotice(null); }
  catch { if (!scope.signal.aborted) setNotice('unconfirmed'); }
  finally { reloadPending.current = false; if (!scope.signal.aborted) setReloading(false); }
 }
 useUnsavedDraft({ dirty: false, pending: pending.size > 0, canSave: false, save: async () => false });
 return { create, update, remove, reload, reloading, pending, notice, calendarNotice, registerNewControl, deleteControl, actionControl };
}
