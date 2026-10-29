'use client';

import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { EntityBadge } from '@/components/ui/status-badge';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useGuardedNavigation } from '@/components/navigation-guard';
import { AddSource, EditSource, SourceNoticeText } from './dneskai-source-forms';
import { useSourceActions } from './use-source-actions';
import { DneskaiCodeText } from './dneskai/code-text';
import { qk } from '@/lib/queries/keys';
import { dneskaiSourceList as copy } from '@/lib/i18n/sections/dneskai-source-list';
import { formatDneskaiDayTime } from '@/lib/marketing/dneskai-workspace';
import { dneskaiSourceLabel, type DneskaiSourceList, type DneskaiSourceRow } from '@/lib/marketing/dneskai-source-list';
import { loadDneskaiSourceList } from '@/lib/marketing/dneskai-source-list-client';
import { cn } from '@/lib/utils';

type Lang = 'en' | 'cs';
type Item = DneskaiSourceList['items'][number];

/**
 * Zdroje (#174): what DNESKAi reads, as two lists, Instagram profily and Weby. Each row shows the handle or domain,
 * its kind, tier, days, the last read and its item count, and a switch; add, edit and remove change the owner's rows
 * while DNESKAI_SOURCES_TABLE_ENABLED is on. Off (and in the preview) it lists the registry file read-only.
 */
export function DneskaiSourceList({ projectId, lang, preview = false }: { projectId: string; lang: Lang; preview?: boolean }) {
  return <SourceList key={`${projectId}:${preview}`} projectId={projectId} lang={lang} preview={preview} />;
}
function SourceList({ projectId, lang, preview }: { projectId: string; lang: Lang; preview: boolean }) {
  const t = copy[lang];
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const filterId = useId();
  const key = [...qk.dneskaiSourceList, projectId, preview];
  const query = useQuery({ queryKey: key, retry: false, structuralSharing: false, staleTime: 30_000, queryFn: ({ signal }) => loadDneskaiSourceList(projectId, preview, signal) });
  const actions = useSourceActions({ projectId, preview, queryKey: key, lang });
  const navigate = useGuardedNavigation();
  const [editing, setEditing] = useState<DneskaiSourceRow | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  if (!showAdd && query.data?.editable && !preview) setShowAdd(true);
  const data = query.data;
  const filtered = data?.items.filter(item => (kind === 'all' || (item.row.kind === 'instagram' ? 'instagram' : 'web') === kind) && `${dneskaiSourceLabel(item.row)} ${item.row.name} ${item.row.handleOrUrl}`.toLocaleLowerCase(lang).includes(search.trim().toLocaleLowerCase(lang))) ?? [];
  const editable = !!data?.editable && !query.isError && !preview;
  return <section aria-labelledby={`${filterId}-title`} className="min-w-0 space-y-5" data-testid="dneskai-source-list">
    <div><h2 id={`${filterId}-title`} className="sr-only">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {data && !data.editable && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted">{preview ? t.preview : data.notice ? t.tableMissing : t.readOnly}</p>}
    {actions.notice && actions.notice.origin !== 'add' && !(actions.notice.origin === 'edit' && editing) && <SourceNoticeText notice={actions.notice} lang={lang} />}
    {showAdd && <AddSource lang={lang} items={data?.items ?? []} available={editable} actions={actions} />}
    {query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : query.isError || !data ? <div role="alert"><p className="text-sm text-risk">{t.unavailable}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t.retry}</Button></div>
        : <>
          <div className="flex flex-wrap items-end gap-3" role="search">
            <div className="min-w-48 flex-1"><label htmlFor={`${filterId}-search`} className="sr-only">{t.search}</label><Input id={`${filterId}-search`} type="search" placeholder={t.search} value={search} onChange={event => setSearch(event.target.value)} /></div>
            <label className="sr-only" htmlFor={`${filterId}-kind`}>{t.allKinds}</label><select id={`${filterId}-kind`} value={kind} onChange={event => setKind(event.target.value)} className="min-h-11 rounded-md border border-border bg-surface px-3 text-sm focus-ring md:min-h-8"><option value="all">{t.allKinds}</option><option value="instagram">{t.instagram}</option><option value="web">{t.web}</option></select>
            <span role="status" className="py-2 text-xs text-foreground-muted tabular">{filtered.length} / {data.items.length}</span>
          </div>
          {!filtered.length && <p role="status" className="text-sm text-foreground-muted">{search || kind !== 'all' ? t.noMatches : t.empty}</p>}
          {(['instagram', 'web'] as const).map((group) => {
            const items = filtered.filter((item) => (item.row.kind === 'instagram') === (group === 'instagram'));
            if (!items.length) return null;
            return <section key={group} aria-labelledby={`${filterId}-${group}`} className="min-w-0 space-y-2" data-testid={`dneskai-sources-${group}`}>
              <h3 id={`${filterId}-${group}`} className="text-sm font-semibold">{t[group]} <span className="font-normal text-foreground-muted tabular">{items.length}</span></h3>
              <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{items.map(item => <SourceRow key={item.row.sourceId} item={item} lang={lang} editable={editable} busy={actions.pending}
                onToggle={enabled => { void actions.save({ ...item.row, enabled }, item.row, 'list'); }}
                onEdit={() => { if (!actions.isBusy()) navigate(() => { actions.clearNotice(); setEditing(item.row); }); }} onRemove={() => actions.remove(item.row)} />)}</ul>
            </section>;
          })}
        </>}
    {editing && <EditSource row={editing} latest={data?.items.find(item => item.row.sourceId === editing.sourceId)?.row ?? null} lang={lang} available={editable} actions={actions}
      reload={async () => { const result = await query.refetch(); return result.isSuccess && result.data.editable ? result.data.items.find(item => item.row.sourceId === editing.sourceId)?.row ?? null : null; }}
      onClose={() => { actions.clearNotice(); setEditing(null); }} onSaved={() => setEditing(null)} />}
  </section>;
}

function SourceRow({ item, lang, editable, busy, onToggle, onEdit, onRemove }: { item: Item; lang: Lang; editable: boolean; busy: boolean; onToggle: (enabled: boolean) => void; onEdit: () => void; onRemove: () => void }) {
  const t = copy[lang];
  const { row } = item;
  const label = dneskaiSourceLabel(row);
  const days = row.weekdays.length === 7 ? t.everyDay : [...row.weekdays].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((day) => t.weekdays[day]).join(' ');
  return <li className={cn('grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start sm:grid-cols-[2rem_minmax(0,1fr)_auto] sm:items-center gap-3 px-3 py-2.5', !row.enabled && 'text-foreground-muted')} data-testid="dneskai-source-row" data-source={row.sourceId}>
    <span aria-hidden className="hidden size-8 items-center sm:flex justify-center rounded-full border border-border bg-surface-inset text-xs font-semibold uppercase">{label.replace('@', '').slice(0, 1)}</span>
    <div className="grid min-w-0 gap-x-4 gap-y-1 lg:grid-cols-[minmax(0,1fr)_auto]">
      <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="break-all text-sm font-medium">{label}</span>{row.name !== row.handleOrUrl && row.name !== label.replace('@', '') && <span className="text-xs text-foreground-muted">{row.name}</span>}</p>
      <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
        <EntityBadge>{t.topics[row.topic]}</EntityBadge><EntityBadge><span title={t.tiersHelp}>{t.tiers[row.tier]}</span></EntityBadge><span>{days}</span>
      </p>
      {row.kind !== 'instagram' && <p className="break-all text-xs text-foreground-muted lg:col-start-1">{row.handleOrUrl}</p>}
      <p className="text-xs text-foreground-muted lg:col-start-1">{item.lastReadAt ? <>{t.lastRead}: <time dateTime={item.lastReadAt} className="tabular">{formatDneskaiDayTime(item.lastReadAt)}</time>{item.lastItems !== null && <> · {t.items(item.lastItems)}</>}</> : t.neverRead}
      </p>
      {item.lastErrorCode && <DneskaiCodeText code={item.lastErrorCode} lang={lang} className="lg:col-start-1" />}
    </div>
    <div className="col-start-2 row-start-1 flex flex-wrap sm:col-start-3 items-center justify-end gap-1 max-sm:max-w-32">
      <Switch checked={row.enabled} disabled={!editable || busy} aria-label={t.readSwitch(label)} onCheckedChange={onToggle} />
      {editable && <><Button variant="ghost" size="sm" disabled={busy} aria-label={t.editName(label)} onClick={onEdit}>{t.edit}</Button>
        <Button variant="ghost" size="sm" disabled={busy} aria-label={t.removeName(label)} onClick={onRemove}>{t.remove}</Button></>}
    </div>
  </li>;
}
