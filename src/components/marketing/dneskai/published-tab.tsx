'use client';

import { useState } from 'react';
import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { DNESKAI_POST_FILTERS, dneskaiPostList, dneskaiPostMatches, type DneskaiPostFilter, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiCodeText, DneskaiDetails } from './code-text';
import { DneskaiStateChip } from './state-chip';
import { TabHeader, pragueDateTime } from './review-tab';

type Lang = 'en' | 'cs';

/** Switches the workspace to the Design Lab with this post open (the Lab reads `labPost` when it mounts). */
function openInLab(id: string) {
  const url = new URL(window.location.href);
  url.searchParams.set('projectTab', 'dneskai-review'); url.searchParams.set('labPost', id); url.searchParams.set('labSlide', '0');
  window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new Event('project-tab'));
}

/**
 * Příspěvky (#169): one list of every post, the former review list and the publication receipts together. Filter chips
 * narrow it to the posts waiting, scheduled, published or in error; a post that can still be edited opens in the Lab.
 */
export function DneskaiPublishedTab({ read, lang, preview, refreshing, onRefresh, renderFailed }: { read: DneskaiWorkspaceRead; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void; renderFailed?: ReadonlySet<string> }) {
  const t = dneskaiWorkspace[lang];
  const [filter, setFilter] = useState<DneskaiPostFilter>('all');
  const all = dneskaiPostList(read, renderFailed);
  const posts = all.filter((item) => dneskaiPostMatches(item.state.state, filter));
  return <section aria-labelledby="dneskai-published-title" className="min-w-0 space-y-5" data-testid="dneskai-published">
    <TabHeader id="dneskai-published-title" title={t.published.title} intro={t.published.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} unreadable={read.unreadable} />
    <div role="group" aria-label={t.published.filters.label} className="flex flex-wrap gap-1" data-testid="dneskai-post-filters">
      {DNESKAI_POST_FILTERS.map((key) => {
        const count = all.filter((item) => dneskaiPostMatches(item.state.state, key)).length;
        return <Button key={key} variant={filter === key ? 'subtle' : 'ghost'} size="sm" aria-pressed={filter === key} onClick={() => setFilter(key)}>
          {t.published.filters[key]} <span className="tabular text-foreground-muted">{count}</span>
        </Button>;
      })}
    </div>
    {posts.length === 0 ? <EmptyState align="start" title={all.length === 0 ? t.published.empty : t.published.emptyFilter} className="rounded-lg border border-border bg-surface" />
      : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{posts.map(({ post, state }) => {
        const cover = post.assets[0];
        const at = post.publication?.publishedAt ?? null;
        const editable = post.status === 'review' || post.status === 'returned';
        return <li key={post.id} className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]" data-testid="dneskai-post-row" data-state={state.state}>
          {cover ? <Image unoptimized src={cover.url} alt={t.published.cover(post.title)} width={cover.width} height={cover.height} loading="lazy" sizes="4.5rem" className="h-auto w-full rounded border border-border" />
            : <span className="flex aspect-[4/5] items-center justify-center rounded border border-dashed border-border-strong text-center text-[10px] text-foreground-muted">{t.card.notRendered}</span>}
          <div className="min-w-0 space-y-1">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-2"><p className="min-w-0 break-words text-sm font-medium">{post.title}</p><DneskaiStateChip detail={state} lang={lang} /></div>
            <dl className="grid gap-x-4 gap-y-0.5 text-xs text-foreground-muted sm:grid-cols-2">
              <div><dt className="inline">{at ? t.published.at : t.published.planned}: </dt><dd className="inline tabular"><time dateTime={at ?? post.scheduledAt}>{pragueDateTime(at ?? post.scheduledAt, lang)}</time></dd></div>
              <div><dt className="inline">{t.published.account}: </dt><dd className="inline">@{post.account.handle}</dd></div>
            </dl>
            {state.state === 'problem' && <DneskaiCodeText code={state.code} lang={lang} />}
            {state.state === 'published' && (post.publication?.remoteUrl ? <a href={post.publication.remoteUrl} target="_blank" rel="noopener noreferrer" aria-label={`${t.published.open}: ${post.title}`} className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-information underline focus-ring md:min-h-6">{t.published.open}<ExternalLink className="size-3.5" aria-hidden /></a>
              : <p className="text-xs text-foreground-muted">{t.published.noLink}</p>)}
            {editable && <Button variant="outline" size="sm" aria-label={t.published.openLabName(post.title)} onClick={() => openInLab(post.id)}>{t.published.openLab}</Button>}
            <DneskaiDetails lang={lang} rows={[[t.detailPublication, post.publication?.id], [t.detailRevision, post.id], [t.detailHash, post.contentHash], [t.detailTrace, post.traceId]]} />
          </div>
        </li>;
      })}</ul>}
  </section>;
}
