'use client';

import { useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { EntityBadge, StatusBadge } from '@/components/ui/status-badge';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { DNESKAI_TOPIC_ARCHIVED_STATUSES, DNESKAI_TOPIC_KEYWORD, DNESKAI_TOPIC_KINDS, type DneskaiTopic, type DneskaiTopicAction, type DneskaiTopicActionResult, type DneskaiTopicsRead, type DneskaiTopicStatus } from '@/lib/marketing/dneskai-topics';
import { dneskaiTopicsApi, dneskaiTopicsKey } from '@/lib/marketing/dneskai-topics-client';
import { cn } from '@/lib/utils';

type Lang = 'en' | 'cs';
type Decision = 'approve' | 'reject' | 'restore';
const OPEN: readonly DneskaiTopicStatus[] = ['proposed', 'approved'];
const NEXT: Record<Decision, DneskaiTopicStatus> = { approve: 'approved', reject: 'rejected', restore: 'proposed' };
const ALLOWED: Record<Decision, readonly DneskaiTopicStatus[]> = { approve: ['proposed'], reject: ['proposed', 'approved'], restore: ['rejected', 'expired'] };
const VERDICT_TONE = { fact: 'success', hype: 'risk', unclear: 'warning' } as const;

/** The read with the decision applied to the topics it may change: the optimistic state the server will confirm. */
function applyDecision(read: DneskaiTopicsRead, action: Decision, ids: ReadonlySet<string>, at: string): DneskaiTopicsRead {
  const next = structuredClone(read);
  for (const kind of DNESKAI_TOPIC_KINDS) {
    const moved: DneskaiTopic[] = [];
    for (const status of ALLOWED[action]) {
      next.groups[kind][status] = next.groups[kind][status].filter((topic) => {
        if (!ids.has(topic.id)) return true;
        moved.push({ ...topic, status: NEXT[action], approvedAt: action === 'approve' ? at : null, updatedAt: at });
        return false;
      });
    }
    next.groups[kind][NEXT[action]] = [...moved, ...next.groups[kind][NEXT[action]]];
  }
  return next;
}
function applyKeyword(read: DneskaiTopicsRead, id: string, keyword: string | null): DneskaiTopicsRead {
  const next = structuredClone(read);
  for (const kind of DNESKAI_TOPIC_KINDS) for (const [status, topics] of Object.entries(next.groups[kind])) {
    next.groups[kind][status as DneskaiTopicStatus] = topics.map((topic) => topic.id === id ? { ...topic, keyword } : topic);
  }
  return next;
}

/**
 * Topics (náměty, #154) at the top of the Design Lab: proposed titles grouped News and Education, each approved or
 * rejected by the owner before anything is researched or generated. Keyboard: arrow keys move between rows, A
 * approves and Z rejects the focused row. Renders nothing while the server has topics off (the read is null).
 */
export function DneskaiTopicsList({ projectId, lang, preview }: { projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiLab[lang].topics;
  const queryClient = useQueryClient();
  const key = dneskaiTopicsKey(projectId);
  const query = useQuery({ queryKey: key, staleTime: 30_000, retry: false, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => (await dneskaiTopicsApi(preview)).loadTopics(projectId, signal) });
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState('');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const mutation = useMutation<DneskaiTopicActionResult, Error, DneskaiTopicAction, { before?: DneskaiTopicsRead | null }>({
    mutationFn: async (action) => (await dneskaiTopicsApi(preview)).act(action),
    onMutate: async (action) => {
      await queryClient.cancelQueries({ queryKey: key });
      const before = queryClient.getQueryData<DneskaiTopicsRead | null>(key);
      if (before) {
        const at = new Date().toISOString();
        queryClient.setQueryData(key, action.action === 'edit' ? applyKeyword(before, action.topicId, action.keyword)
          : action.action === 'create' ? before : applyDecision(before, action.action, new Set(action.topicIds), at));
      }
      return { before };
    },
    onError: (_error, _action, context) => { if (context?.before !== undefined) queryClient.setQueryData(key, context.before); setNotice(t.failed); },
    onSuccess: (result, action) => {
      const done = result.results.filter((item) => 'status' in item).length;
      const changed = result.results.length - done;
      const message = action.action === 'edit' ? (done ? t.done.edit : '') : action.action === 'create' ? '' : done ? t.done[action.action](done) : '';
      setNotice([message, changed ? t.changed(changed) : ''].filter(Boolean).join(' '));
    },
    // Not awaited: the buttons free up as soon as the server answered; the confirming read follows.
    onSettled: () => { void queryClient.invalidateQueries({ queryKey: key }); },
  });
  const read = query.data;
  const open = useMemo(() => read ? DNESKAI_TOPIC_KINDS.map((kind) => ({ kind, topics: OPEN.flatMap((status) => read.groups[kind][status]) })) : [], [read]);
  const archived = useMemo(() => read ? DNESKAI_TOPIC_KINDS.flatMap((kind) => DNESKAI_TOPIC_ARCHIVED_STATUSES.flatMap((status) => read.groups[kind][status])) : [], [read]);
  const rows = open.flatMap((group) => group.topics);
  const proposedIds = new Set(rows.filter((topic) => topic.status === 'proposed').map((topic) => topic.id));
  const chosen = [...selected].filter((id) => proposedIds.has(id));
  if (query.isPending || read === null) return null;
  if (query.isError || !read) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;

  const decide = (action: Decision, ids: string[]) => {
    if (!ids.length || mutation.isPending) return;
    setNotice('');
    setSelected((current) => new Set([...current].filter((id) => !ids.includes(id))));
    mutation.mutate({ action, projectId, topicIds: ids });
  };
  const focusRow = (id: string) => { setFocusId(id); listRef.current?.querySelector<HTMLElement>(`[data-topic-row="${id}"]`)?.focus(); };
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target instanceof HTMLInputElement) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-topic-row]');
    const id = row?.dataset.topicRow;
    const at = rows.findIndex((topic) => topic.id === id);
    const keyName = event.key.toLowerCase();
    if (keyName === 'arrowdown' || keyName === 'arrowup') {
      event.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, at < 0 ? 0 : at + (keyName === 'arrowdown' ? 1 : -1)))];
      if (next) focusRow(next.id);
      return;
    }
    if (at < 0 || (keyName !== 'a' && keyName !== 'z')) return;
    const topic = rows[at]!;
    const action: Decision = keyName === 'a' ? 'approve' : 'reject';
    if (!ALLOWED[action].includes(topic.status)) return;
    event.preventDefault();
    decide(action, [topic.id]);
    const following = rows[at + 1] ?? rows[at - 1];
    if (following && action === 'reject') focusRow(following.id);
  };
  const tabStop = focusId && rows.some((topic) => topic.id === focusId) ? focusId : rows[0]?.id;
  const time = read.lastProposedAt ? new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(read.lastProposedAt)) : null;

  return <section aria-labelledby={`${projectId}-topics-title`} className="space-y-3 rounded-md border border-border bg-surface p-3" data-testid="dneskai-topics" aria-busy={mutation.isPending}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0"><h3 id={`${projectId}-topics-title`} className="text-sm font-semibold">{t.title}</h3><p className="text-xs text-foreground-muted">{t.intro}</p></div>
      {chosen.length > 0 && <Button size="sm" disabled={mutation.isPending} onClick={() => decide('approve', chosen)} data-testid="dneskai-topics-approve-selected">{t.approveSelected(chosen.length)}</Button>}
    </div>
    <p role="status" className="text-xs empty:hidden">{notice}</p>
    {rows.length === 0 ? <div className="text-sm" data-testid="dneskai-topics-empty"><p className="font-medium">{t.empty}</p><p className="text-xs text-foreground-muted">{time ? t.lastSearch(time) : t.noSearch}</p></div>
      : <div ref={listRef} onKeyDown={onKeyDown} className="space-y-3">
        <p className="text-xs text-foreground-muted">{t.keys}</p>
        {open.filter((group) => group.topics.length).map((group) => <div key={group.kind} className="space-y-1">
          <h4 className="text-xs font-semibold">{t.groups[group.kind]} <span className="font-normal text-foreground-muted tabular">{group.topics.length}</span></h4>
          <ul aria-label={t.listLabel(t.groups[group.kind])} className="divide-y divide-border">
            {group.topics.map((topic) => <TopicRow key={topic.id} topic={topic} lang={lang} tabStop={tabStop === topic.id} busy={mutation.isPending}
              selected={selected.has(topic.id)} onSelect={(value) => setSelected((current) => { const next = new Set(current); if (value) next.add(topic.id); else next.delete(topic.id); return next; })}
              onFocus={() => setFocusId(topic.id)} onDecide={(action) => decide(action, [topic.id])}
              editing={editing === topic.id} onEdit={(value) => setEditing(value ? topic.id : null)}
              onSaveKeyword={(keyword) => { setEditing(null); setNotice(''); mutation.mutate({ action: 'edit', projectId, topicId: topic.id, title: topic.title, keyword }); }} />)}
          </ul>
        </div>)}
      </div>}
    <details className="text-sm" data-testid="dneskai-topics-archive">
      <summary className="cursor-pointer text-xs font-medium focus-ring rounded-sm">{t.archive(archived.length)}</summary>
      {archived.length === 0 ? <p className="mt-2 text-xs text-foreground-muted">{t.archiveEmpty}</p> : <ul className="mt-2 divide-y divide-border">
        {archived.map((topic) => <li key={topic.id} className="flex flex-wrap items-center gap-2 py-2">
          <span className="min-w-0 flex-1 break-words text-foreground-muted">{topic.title}</span>
          <StatusBadge value={`topic-${topic.status}`} label={t.archived[topic.status as 'rejected' | 'expired']} tone="neutral" />
          <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => decide('restore', [topic.id])} aria-label={`${t.restore}: ${topic.title}`}>{t.restore}</Button>
        </li>)}
      </ul>}
    </details>
  </section>;
}

function TopicRow({ topic, lang, tabStop, busy, selected, onSelect, onFocus, onDecide, editing, onEdit, onSaveKeyword }: {
  topic: DneskaiTopic; lang: Lang; tabStop: boolean; busy: boolean; selected: boolean; onSelect: (value: boolean) => void; onFocus: () => void;
  onDecide: (action: Decision) => void; editing: boolean; onEdit: (value: boolean) => void; onSaveKeyword: (keyword: string | null) => void;
}) {
  const t = dneskaiLab[lang].topics;
  const titleId = useId(), helpId = useId();
  const [draft, setDraft] = useState(topic.keyword ?? '');
  const valid = draft.trim() === '' || DNESKAI_TOPIC_KEYWORD.test(draft.trim());
  const proposed = topic.status === 'proposed';
  return <li data-topic-row={topic.id} tabIndex={tabStop ? 0 : -1} onFocus={(event) => { if (event.target === event.currentTarget) onFocus(); }} aria-labelledby={titleId}
    className="flex flex-col gap-2 py-2 focus-ring rounded-sm sm:flex-row sm:items-start">
    <div className="flex min-w-0 flex-1 items-start gap-2">
      {proposed ? <Checkbox className="mt-0.5" checked={selected} onCheckedChange={(value) => onSelect(value === true)} aria-label={t.select(topic.title)} disabled={busy} />
        : <span className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
      <div className="min-w-0 flex-1 space-y-1">
        <p id={titleId} className="break-words text-sm font-medium">{topic.title}</p>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-muted">
          <EntityBadge>{t.groups[topic.kind]}</EntityBadge>
          {topic.source.label ? topic.source.url ? <a href={topic.source.url} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline focus-ring rounded-sm">{topic.source.label}</a>
            : <span>{topic.source.label}</span> : <span>{t.manual}</span>}
          {topic.verdict && <StatusBadge value={`topic-${topic.verdict}`} label={t.verdict[topic.verdict]} tone={VERDICT_TONE[topic.verdict]} />}
          {topic.status === 'approved' && <StatusBadge value="topic-approved" label={t.approved} tone="success" />}
          {!editing && <button type="button" disabled={busy} onClick={() => { setDraft(topic.keyword ?? ''); onEdit(true); }}
            className="inline-flex min-h-6 items-center rounded-sm border border-dashed border-border-strong px-2 font-mono text-[11px] text-foreground hover:bg-surface-secondary focus-ring disabled:opacity-50"
            aria-label={topic.keyword ? t.keyword.edit(topic.keyword) : t.keyword.add}>{topic.keyword ? `#${topic.keyword}` : t.keyword.add}</button>}
        </div>
        {editing && <form className="flex flex-wrap items-start gap-2" onSubmit={(event) => { event.preventDefault(); if (valid) onSaveKeyword(draft.trim() || null); }}
          onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); onEdit(false); } }}>
          <div className="min-w-0 flex-1 basis-48">
            <Input autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={t.keyword.label} aria-describedby={helpId} aria-invalid={!valid} maxLength={24} className="h-8 font-mono" />
            <p id={helpId} className={cn('mt-1 text-[11px]', valid ? 'text-foreground-muted' : 'text-risk')}>{t.keyword.help}</p>
          </div>
          <Button type="submit" size="sm" disabled={!valid || busy}>{t.keyword.save}</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => onEdit(false)}>{t.keyword.cancel}</Button>
        </form>}
      </div>
    </div>
    <div className="flex shrink-0 gap-2 pl-6 sm:pl-0">
      {proposed && <Button size="sm" disabled={busy} onClick={() => onDecide('approve')} aria-label={`${t.approve}: ${topic.title}`} data-testid="dneskai-topic-approve">{t.approve}</Button>}
      <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecide('reject')} aria-label={`${t.reject}: ${topic.title}`} data-testid="dneskai-topic-reject">{t.reject}</Button>
    </div>
  </li>;
}
