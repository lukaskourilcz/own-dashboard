'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useGuardedNavigation, useUnsavedDraft } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { dneskaiSourceList as copy } from '@/lib/i18n/sections/dneskai-source-list';
import { DNESKAI_SOURCE_TOPICS, DneskaiSourceRowSchema, dneskaiDetectSource, dneskaiSourceLabel, dneskaiWebSourceId, sameDneskaiSourceRow, type DneskaiSourceList, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
import type { SourceActions, SourceNotice } from './use-source-actions';

type Lang = 'en' | 'cs';
const select = 'min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring md:min-h-8';
export function SourceNoticeText({ notice, lang }: { notice: SourceNotice; lang: Lang }) {
  const t = copy[lang], success = notice.code === 'saved' || notice.code === 'removed';
  return <p role={success ? 'status' : 'alert'} className={`text-sm ${success ? 'text-success' : 'text-risk'}`}>
    {notice.code === 'saved' ? t.saved : notice.code === 'removed' ? t.removed : Object.hasOwn(t.errors, notice.code) ? t.errors[notice.code] : t.errors['sources-unavailable']}
  </p>;
}

export function AddSource({ lang, items, available, actions }: { lang: Lang; items: DneskaiSourceList['items']; available: boolean; actions: SourceActions }) {
  const t = copy[lang].add, id = useId();
  const [value, setValue] = useState(''), immediate = useRef('');
  const [topic, setTopic] = useState<DneskaiSourceRow['topic']>('education');
  const [error, setError] = useState<'invalid' | 'exists' | null>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const detected = dneskaiDetectSource(value);
  const update = (next: string) => { if (actions.isBusy()) return; immediate.current = next; setValue(next); setError(null); actions.clearNotice(); };
  async function save(): Promise<boolean> {
    if (actions.isBusy() || !available) return false;
    const found = dneskaiDetectSource(immediate.current);
    if (!found) { setError('invalid'); return false; }
    const row: DneskaiSourceRow = found.kind === 'instagram'
      ? { sourceId: `instagram:${found.handle}`, kind: 'instagram', topic, handleOrUrl: found.handle, name: found.handle, tier: 0, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true }
      : { sourceId: dneskaiWebSourceId(found.url), kind: found.kind, topic, handleOrUrl: found.url, name: found.host, tier: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true };
    // A lost acknowledgement may already have committed this exact row. Its
    // idempotent retry is safe; an existing different source needs an edit.
    if (items.some(item => (item.row.sourceId === row.sourceId || item.row.handleOrUrl === row.handleOrUrl) && !sameDneskaiSourceRow(item.row, row))) { setError('exists'); return false; }
    setError(null);
    const result = await actions.save(row, null, 'add');
    if (result.kind !== 'confirmed' || !mounted.current) return false;
    immediate.current = ''; setValue(''); return true;
  }
  useUnsavedDraft({ get dirty() { return immediate.current !== ''; }, canSave: available && !!detected && !actions.pending, save,
    discard: () => { immediate.current = ''; setValue(''); setError(null); actions.clearNotice(); } });
  return <form onSubmit={event => { event.preventDefault(); void save(); }} className="form-frame space-y-2" aria-labelledby={`${id}-title`} aria-busy={actions.pending} noValidate>
    <h3 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h3>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-end">
      <div className="min-w-0"><label htmlFor={`${id}-value`} className="text-xs font-medium">{t.field}</label>
        <Input id={`${id}-value`} value={value} maxLength={2048} autoComplete="off" readOnly={!available || actions.pending} aria-describedby={`${id}-help ${id}-detected`} aria-invalid={!!error} onChange={event => update(event.target.value)} /></div>
      <div><label htmlFor={`${id}-topic`} className="text-xs font-medium">{t.topic}</label>
        <select id={`${id}-topic`} className={select} value={topic} disabled={!available || actions.pending} onChange={event => { if (!actions.isBusy()) { setTopic(event.target.value as DneskaiSourceRow['topic']); actions.clearNotice(); } }}>{DNESKAI_SOURCE_TOPICS.map(item => <option key={item} value={item}>{copy[lang].topics[item]}</option>)}</select></div>
      <div className="flex flex-wrap gap-2"><Button type="submit" disabled={!available || actions.pending || !value.trim()}>{actions.pending ? t.adding : t.submit}</Button>
        {value !== '' && <Button type="button" variant="outline" disabled={actions.pending} onClick={() => update('')}>{t.discard}</Button>}</div>
    </div>
    <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.help}</p>
    <p id={`${id}-detected`} className={`text-xs ${error ? 'text-risk' : ''}`} role={error ? 'alert' : 'status'}>{error ? t[error] : detected ? (detected.kind === 'instagram' ? t.detected.instagram(detected.handle) : t.detected[detected.kind](detected.host)) : null}</p>
    {actions.notice?.origin === 'add' && <SourceNoticeText notice={actions.notice} lang={lang} />}
  </form>;
}

type Draft = Omit<DneskaiSourceRow, 'maxItems'> & { maxItems: string };
const draftOf = (row: DneskaiSourceRow): Draft => ({ ...row, weekdays: [...row.weekdays], maxItems: String(row.maxItems) });
function dirtyDraft(draft: Draft, row: DneskaiSourceRow) {
  return draft.name !== row.name || draft.maxItems !== String(row.maxItems) || draft.topic !== row.topic || draft.tier !== row.tier
    || draft.weekdays.length !== row.weekdays.length || draft.weekdays.some(day => !row.weekdays.includes(day));
}
export function EditSource({ row, latest, lang, available, actions, reload, onClose, onSaved }: {
  row: DneskaiSourceRow; latest: DneskaiSourceRow | null; lang: Lang; available: boolean; actions: SourceActions;
  reload: () => Promise<DneskaiSourceRow | null>; onClose: () => void; onSaved: () => void;
}) {
  const t = copy[lang], id = useId(), navigate = useGuardedNavigation();
  const [source, setSource] = useState(row), sourceRef = useRef(row);
  const [draft, setDraft] = useState<Draft>(() => draftOf(row)), immediate = useRef<Draft>(draftOf(row));
  const [validate, setValidate] = useState(false), [reloading, setReloading] = useState(false), [reloadFailed, setReloadFailed] = useState(false);
  const loadingRef = useRef(false), finished = useRef(false), mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const changed = !sameDneskaiSourceRow(source, latest), busy = actions.pending || reloading;
  const parsed = DneskaiSourceRowSchema.safeParse({ ...draft, name: draft.name.trim(), maxItems: draft.maxItems.trim() === '' ? NaN : Number(draft.maxItems) });
  const badName = !draft.name.trim() || /\p{Cc}/u.test(draft.name), badNumber = draft.maxItems.trim() === '' || !Number.isSafeInteger(Number(draft.maxItems)) || Number(draft.maxItems) < 1 || Number(draft.maxItems) > 20;
  const update = (patch: Partial<Draft>) => {
    if (actions.isBusy() || loadingRef.current) return;
    const next = { ...immediate.current, ...patch }; immediate.current = next; setDraft(next); setValidate(false); actions.clearNotice(); setReloadFailed(false);
  };
  async function save(): Promise<boolean> {
    if (actions.isBusy() || loadingRef.current || !available || changed) return false;
    const current = immediate.current;
    const value = DneskaiSourceRowSchema.safeParse({ ...current, name: current.name.trim(), maxItems: current.maxItems.trim() === '' ? NaN : Number(current.maxItems) });
    if (!value.success) { setValidate(true); return false; }
    const result = await actions.save(value.data, sourceRef.current, 'edit');
    if (result.kind !== 'confirmed' || !mounted.current) return false;
    finished.current = true; onSaved(); return true;
  }
  function discard() { immediate.current = draftOf(sourceRef.current); setDraft(immediate.current); setValidate(false); actions.clearNotice(); }
  useUnsavedDraft({ get dirty() { return !finished.current && dirtyDraft(immediate.current, sourceRef.current); }, get pending() { return loadingRef.current; },
    canSave: available && !changed && parsed.success && !busy, save, discard });
  const close = () => { if (!actions.isBusy() && !loadingRef.current) navigate(onClose); };
  async function refresh() {
    if (actions.isBusy() || loadingRef.current) return;
    loadingRef.current = true; setReloading(true); setReloadFailed(false);
    try {
      const value = await reload();
      if (!mounted.current) return;
      if (!value) { setReloadFailed(true); return; }
      sourceRef.current = value; setSource(value); immediate.current = draftOf(value); setDraft(immediate.current); setValidate(false); actions.clearNotice();
    } catch { if (mounted.current) setReloadFailed(true); }
    finally { loadingRef.current = false; if (mounted.current) setReloading(false); }
  }
  const errorFor = (field: string, text: string, invalid: boolean) => validate && invalid ? <p id={`${id}-${field}-error`} role="alert" className="text-xs text-risk">{text}</p> : null;
  return <Dialog open onOpenChange={open => { if (!open) close(); }}><DialogContent className="max-w-md" data-testid="dneskai-source-edit" aria-busy={busy} showClose={!busy}
    onEscapeKeyDown={event => { if (actions.isBusy() || loadingRef.current) event.preventDefault(); }} onPointerDownOutside={event => { if (actions.isBusy() || loadingRef.current) event.preventDefault(); }}>
    <DialogHeader><DialogTitle>{t.form.title(dneskaiSourceLabel(source))}</DialogTitle><DialogDescription className="break-all">{source.kind === 'instagram' ? t.form.description : source.handleOrUrl}</DialogDescription></DialogHeader>
    {(!available || changed) && <div className="space-y-2"><p role="alert" className="text-sm text-risk">{!available ? t.form.unavailable : t.form.changed}</p><Button type="button" variant="outline" disabled={busy} onClick={() => void refresh()}>{reloading ? t.loading : t.form.reload}</Button></div>}
    {reloadFailed && <p role="alert" className="text-sm text-risk">{t.form.reloadFailed}</p>}
    {actions.notice?.origin === 'edit' && !(changed && actions.notice.code === 'source-changed') && <SourceNoticeText notice={actions.notice} lang={lang} />}
    <form onSubmit={event => { event.preventDefault(); void save(); }} className="space-y-3" noValidate>
      <div><label htmlFor={`${id}-name`} className="text-xs font-medium">{t.form.name}</label><Input id={`${id}-name`} value={draft.name} maxLength={120} required readOnly={busy || !available} aria-invalid={validate && badName} aria-describedby={validate && badName ? `${id}-name-error` : undefined} onChange={event => update({ name: event.target.value })} />{errorFor('name', t.form.nameMissing, badName)}</div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor={`${id}-topic`} className="text-xs font-medium">{t.form.topic}</label><select id={`${id}-topic`} className={select} value={draft.topic} disabled={busy || !available} onChange={event => update({ topic: event.target.value as Draft['topic'] })}>{DNESKAI_SOURCE_TOPICS.map(item => <option key={item} value={item}>{t.topics[item]}</option>)}</select></div>
        <div><label htmlFor={`${id}-tier`} className="text-xs font-medium">{t.form.tier}</label><select id={`${id}-tier`} className={select} value={draft.tier} disabled={busy || !available} onChange={event => update({ tier: Number(event.target.value) as Draft['tier'] })}>{t.tiers.map((tier, index) => <option key={tier} value={index}>{tier}</option>)}</select></div>
      </div>
      <p className="text-xs text-foreground-muted">{t.tiersHelp}</p>
      <fieldset className="space-y-1" aria-describedby={validate && !draft.weekdays.length ? `${id}-days-error` : undefined}><legend className="text-xs font-medium">{t.form.weekdays}</legend>
        <div className="flex flex-wrap gap-1">{[1, 2, 3, 4, 5, 6, 0].map(day => <label key={day} className="inline-flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md border border-border px-2 text-xs focus-within:ring-2 focus-within:ring-ring md:min-h-8">
          <input type="checkbox" className="accent-primary" disabled={busy || !available} checked={draft.weekdays.includes(day)} onChange={event => update({ weekdays: event.target.checked ? [...immediate.current.weekdays, day] : immediate.current.weekdays.filter(item => item !== day) })} />{t.weekdays[day]}
        </label>)}</div>{errorFor('days', t.form.weekdaysMissing, !draft.weekdays.length)}
      </fieldset>
      <div><label htmlFor={`${id}-items`} className="text-xs font-medium">{t.form.maxItems}</label><Input id={`${id}-items`} type="number" min={1} max={20} step={1} required value={draft.maxItems} readOnly={busy || !available} aria-invalid={validate && badNumber} aria-describedby={validate && badNumber ? `${id}-items-error` : undefined} onChange={event => update({ maxItems: event.target.value })} />{errorFor('items', t.form.itemsInvalid, badNumber)}</div>
      <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={close}>{t.cancel}</Button><Button type="submit" disabled={busy || !available || changed}>{actions.pending ? t.form.saving : t.form.save}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
