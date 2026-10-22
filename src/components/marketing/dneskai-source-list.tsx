'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EntityBadge } from '@/components/ui/status-badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useConfirmation } from '@/components/ui/confirmation-dialog';
import { qk } from '@/lib/queries/keys';
import { dneskaiSourceList as copy } from '@/lib/i18n/sections/dneskai-source-list';
import { formatDneskaiDayTime } from '@/lib/marketing/dneskai-workspace';
import { DNESKAI_SOURCE_TOPICS, dneskaiDetectSource, dneskaiSourceLabel, dneskaiWebSourceId, type DneskaiSourceList, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
import { DneskaiSourceListError, loadDneskaiSourceList, postDneskaiSourceAction } from '@/lib/marketing/dneskai-source-list-client';
import { cn } from '@/lib/utils';

type Lang = 'en' | 'cs';
type Item = DneskaiSourceList['items'][number];
const select = 'min-h-11 w-full rounded-md border border-border bg-surface px-2 text-sm focus-ring md:min-h-8';

/**
 * Zdroje (#174): what DNESKAi reads, as two lists, Instagram profily and Weby. Each row shows the handle or domain,
 * its kind, tier, days, the last read and its item count, and a switch; add, edit and remove change the owner's rows
 * while DNESKAI_SOURCES_TABLE_ENABLED is on. Off (and in the preview) it lists the registry file read-only.
 */
export function DneskaiSourceList({ projectId, lang, preview = false }: { projectId: string; lang: Lang; preview?: boolean }) {
  const t = copy[lang];
  const client = useQueryClient();
  const key = [...qk.dneskaiSourceList, projectId, preview];
  const query = useQuery({ queryKey: key, retry: false, staleTime: 30_000, queryFn: ({ signal }) => loadDneskaiSourceList(projectId, preview, signal) });
  const [status, setStatus] = useState<{ text: string; error: boolean } | null>(null);
  const [editing, setEditing] = useState<DneskaiSourceRow | null>(null);
  const confirm = useConfirmation();
  const mutation = useMutation({
    mutationFn: postDneskaiSourceAction,
    onSuccess: (_result, action) => { setStatus({ text: action.action === 'remove' ? t.removed : t.saved, error: false }); setEditing(null); void client.invalidateQueries({ queryKey: key }); },
    onError: (error) => setStatus({ text: t.errors[error instanceof DneskaiSourceListError ? error.code : 'sources-unavailable'] ?? t.errors['sources-unavailable']!, error: true }),
  });
  const save = (row: DneskaiSourceRow) => mutation.mutate({ action: 'save', projectId, source: row });
  const remove = async (row: DneskaiSourceRow) => {
    const label = dneskaiSourceLabel(row);
    if (await confirm({ title: t.removeTitle(label), description: t.removeDescription, confirmLabel: t.removeConfirm, cancelLabel: t.cancel, destructive: true })) mutation.mutate({ action: 'remove', projectId, sourceId: row.sourceId });
  };
  const data = query.data;
  const editable = !!data?.editable && !preview;
  return <section aria-labelledby="dneskai-source-list-title" className="min-w-0 space-y-5" data-testid="dneskai-source-list">
    <div><h2 id="dneskai-source-list-title" className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {data && !editable && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted">{preview ? t.preview : data.notice ? t.tableMissing : t.readOnly}</p>}
    <div aria-live="polite">{status && <p role={status.error ? 'alert' : 'status'} className={cn('text-sm', status.error ? 'text-risk' : 'text-success')}>{status.text}</p>}</div>
    {query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : query.isError || !data ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
        : <>
          {editable && <AddSource lang={lang} items={data.items} busy={mutation.isPending} onAdd={save} />}
          {(['instagram', 'web'] as const).map((group) => {
            const items = data.items.filter((item) => (item.row.kind === 'instagram') === (group === 'instagram'));
            return <section key={group} aria-labelledby={`dneskai-sources-${group}`} className="min-w-0 space-y-2" data-testid={`dneskai-sources-${group}`}>
              <h3 id={`dneskai-sources-${group}`} className="text-sm font-semibold">{t[group]} <span className="font-normal text-foreground-muted tabular">{items.length}</span></h3>
              {items.length === 0 ? <p className="text-sm text-foreground-muted">{t.empty}</p>
                : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map((item) => <SourceRow key={item.row.sourceId} item={item} lang={lang} editable={editable} busy={mutation.isPending}
                  onToggle={(enabled) => save({ ...item.row, enabled })} onEdit={() => setEditing(item.row)} onRemove={() => void remove(item.row)} />)}</ul>}
            </section>;
          })}
        </>}
    {editing && <EditSource row={editing} lang={lang} busy={mutation.isPending} onClose={() => setEditing(null)} onSave={save} />}
  </section>;
}

function SourceRow({ item, lang, editable, busy, onToggle, onEdit, onRemove }: { item: Item; lang: Lang; editable: boolean; busy: boolean; onToggle: (enabled: boolean) => void; onEdit: () => void; onRemove: () => void }) {
  const t = copy[lang];
  const { row } = item;
  const label = dneskaiSourceLabel(row);
  const days = row.weekdays.length === 7 ? t.everyDay : [...row.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => t.weekdays[day]).join(' ');
  return <li className={cn('grid min-w-0 grid-cols-[2rem_minmax(0,1fr)_auto] items-start gap-3 px-3 py-2.5', !row.enabled && 'text-foreground-muted')} data-testid="dneskai-source-row" data-source={row.sourceId}>
    <span aria-hidden className="flex size-8 items-center justify-center rounded-full border border-border bg-surface-inset text-xs font-semibold uppercase">{label.replace('@', '').slice(0, 1)}</span>
    <div className="min-w-0 space-y-1">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="break-all text-sm font-medium">{label}</span>{row.name !== row.handleOrUrl && row.name !== label.replace('@', '') && <span className="text-xs text-foreground-muted">{row.name}</span>}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
        <EntityBadge>{t.topics[row.topic]}</EntityBadge><EntityBadge><span title={t.tiersHelp}>{t.tiers[row.tier]}</span></EntityBadge><span>{days}</span>
      </p>
      <p className="text-xs text-foreground-muted">{item.lastReadAt ? <>{t.lastRead}: <time dateTime={item.lastReadAt} className="tabular">{formatDneskaiDayTime(item.lastReadAt)}</time>{item.lastItems !== null && <> · {t.items(item.lastItems)}</>}</> : t.neverRead}
        {item.lastErrorCode && <span className="text-risk"> · <code className="font-mono">{item.lastErrorCode}</code></span>}</p>
    </div>
    <div className="flex items-center gap-1">
      <Switch checked={row.enabled} disabled={!editable || busy} aria-label={t.readSwitch(label)} onCheckedChange={onToggle} />
      {editable && <><Button variant="ghost" size="sm" disabled={busy} aria-label={t.editName(label)} onClick={onEdit}>{t.edit}</Button>
        <Button variant="ghost" size="sm" disabled={busy} aria-label={t.removeName(label)} onClick={onRemove}>{t.remove}</Button></>}
    </div>
  </li>;
}

function AddSource({ lang, items, busy, onAdd }: { lang: Lang; items: Item[]; busy: boolean; onAdd: (row: DneskaiSourceRow) => void }) {
  const t = copy[lang].add;
  const id = useId();
  const [value, setValue] = useState('');
  const [topic, setTopic] = useState<DneskaiSourceRow['topic']>('education');
  const [error, setError] = useState<string | null>(null);
  const detected = dneskaiDetectSource(value);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!detected) { setError(t.invalid); return; }
    const row: DneskaiSourceRow = detected.kind === 'instagram'
      ? { sourceId: `instagram:${detected.handle}`, kind: 'instagram', topic, handleOrUrl: detected.handle, name: detected.handle, tier: 0, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true }
      : { sourceId: dneskaiWebSourceId(detected.url), kind: detected.kind, topic, handleOrUrl: detected.url, name: detected.host, tier: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], maxItems: 10, enabled: true };
    if (items.some((item) => item.row.sourceId === row.sourceId || item.row.handleOrUrl === row.handleOrUrl)) { setError(t.exists); return; }
    setError(null); onAdd(row); setValue('');
  }
  return <form onSubmit={submit} className="space-y-2 rounded-lg border border-border bg-surface p-3" aria-labelledby={`${id}-title`} noValidate>
    <h3 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h3>
    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
      <div className="min-w-0"><label htmlFor={`${id}-value`} className="text-xs font-medium">{t.field}</label>
        <Input id={`${id}-value`} value={value} maxLength={2048} autoComplete="off" aria-describedby={`${id}-help ${id}-detected`} aria-invalid={!!error} onChange={(event) => { setValue(event.target.value); setError(null); }} /></div>
      <div><label htmlFor={`${id}-topic`} className="text-xs font-medium">{t.topic}</label>
        <select id={`${id}-topic`} className={select} value={topic} onChange={(event) => setTopic(event.target.value as DneskaiSourceRow['topic'])}>{DNESKAI_SOURCE_TOPICS.map((item) => <option key={item} value={item}>{copy[lang].topics[item]}</option>)}</select></div>
      <Button type="submit" disabled={busy || !value.trim()}>{busy ? t.adding : t.submit}</Button>
    </div>
    <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.help}</p>
    <p id={`${id}-detected`} className="text-xs" aria-live="polite">{error ? <span className="text-risk">{error}</span> : detected ? (detected.kind === 'instagram' ? t.detected.instagram(detected.handle) : t.detected[detected.kind](detected.host)) : null}</p>
  </form>;
}

function EditSource({ row, lang, busy, onClose, onSave }: { row: DneskaiSourceRow; lang: Lang; busy: boolean; onClose: () => void; onSave: (row: DneskaiSourceRow) => void }) {
  const t = copy[lang];
  const id = useId();
  const [draft, setDraft] = useState(row);
  const [problem, setProblem] = useState<string | null>(null);
  const label = dneskaiSourceLabel(row);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.weekdays.length) { setProblem(t.form.weekdaysMissing); return; }
    onSave({ ...draft, name: draft.name.trim() || row.name, maxItems: Math.min(20, Math.max(1, Math.round(draft.maxItems) || row.maxItems)) });
  }
  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}><DialogContent className="max-w-md" data-testid="dneskai-source-edit">
    <DialogHeader><DialogTitle>{t.form.title(label)}</DialogTitle><DialogDescription>{t.tiersHelp}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-3" noValidate>
      <div><label htmlFor={`${id}-name`} className="text-xs font-medium">{t.form.name}</label><Input id={`${id}-name`} value={draft.name} maxLength={120} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor={`${id}-topic`} className="text-xs font-medium">{t.form.topic}</label>
          <select id={`${id}-topic`} className={select} value={draft.topic} onChange={(event) => setDraft({ ...draft, topic: event.target.value as DneskaiSourceRow['topic'] })}>{DNESKAI_SOURCE_TOPICS.map((item) => <option key={item} value={item}>{t.topics[item]}</option>)}</select></div>
        <div><label htmlFor={`${id}-tier`} className="text-xs font-medium">{t.form.tier}</label>
          <select id={`${id}-tier`} className={select} value={draft.tier} onChange={(event) => setDraft({ ...draft, tier: Number(event.target.value) as DneskaiSourceRow['tier'] })}>{t.tiers.map((tier, index) => <option key={tier} value={index}>{tier}</option>)}</select></div>
      </div>
      <fieldset className="space-y-1" aria-describedby={problem ? `${id}-problem` : undefined}><legend className="text-xs font-medium">{t.form.weekdays}</legend>
        <div className="flex flex-wrap gap-1">{[1, 2, 3, 4, 5, 6, 0].map((day) => <label key={day} className="inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-border px-2 text-xs focus-within:ring-2 focus-within:ring-ring md:min-h-8">
          <input type="checkbox" className="accent-primary" checked={draft.weekdays.includes(day)} onChange={(event) => { setProblem(null); setDraft({ ...draft, weekdays: event.target.checked ? [...draft.weekdays, day] : draft.weekdays.filter((item) => item !== day) }); }} />{t.weekdays[day]}
        </label>)}</div>
        {problem && <p id={`${id}-problem`} role="alert" className="text-xs text-risk">{problem}</p>}
      </fieldset>
      <div><label htmlFor={`${id}-items`} className="text-xs font-medium">{t.form.maxItems}</label><Input id={`${id}-items`} type="number" min={1} max={20} value={draft.maxItems} onChange={(event) => setDraft({ ...draft, maxItems: Number(event.target.value) })} /></div>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>{t.cancel}</Button><Button type="submit" disabled={busy}>{busy ? t.form.saving : t.form.save}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
