'use client';

import Image from 'next/image';
import { ExternalLink } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiPublished, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiDetails } from './code-text';
import { TabHeader, pragueDateTime } from './review-tab';

type Lang = 'en' | 'cs';

/** Publication receipts: permalink, time, account and the cover the post went out with (#119). */
export function DneskaiPublishedTab({ read, lang, preview, refreshing, onRefresh }: { read: DneskaiWorkspaceRead; lang: Lang; preview: boolean; refreshing: boolean; onRefresh: () => void }) {
  const t = dneskaiWorkspace[lang];
  const posts = dneskaiPublished(read);
  return <section aria-labelledby="dneskai-published-title" className="min-w-0 space-y-5" data-testid="dneskai-published">
    <TabHeader id="dneskai-published-title" title={t.published.title} intro={t.published.intro} lang={lang} refreshing={refreshing} onRefresh={onRefresh} preview={preview} />
    {posts.length === 0 ? <EmptyState align="start" title={t.published.empty} className="rounded-lg border border-border bg-surface" />
      : <ul className="divide-y divide-border rounded-lg border border-border bg-surface">{posts.map((post) => {
        const cover = post.assets[0];
        const at = post.publication?.publishedAt ?? null;
        return <li key={post.id} className="grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-3 p-3 sm:grid-cols-[4.5rem_minmax(0,1fr)]">
          {cover ? <Image unoptimized src={cover.url} alt={t.published.cover(post.title)} width={cover.width} height={cover.height} loading="lazy" sizes="4.5rem" className="h-auto w-full rounded border border-border" />
            : <span className="flex aspect-[4/5] items-center justify-center rounded border border-dashed border-border-strong text-[10px] text-foreground-muted">{t.card.notRendered}</span>}
          <div className="min-w-0 space-y-1">
            <p className="break-words text-sm font-medium">{post.title}</p>
            <dl className="grid gap-x-4 gap-y-0.5 text-xs text-foreground-muted sm:grid-cols-2">
              <div><dt className="inline">{t.published.at}: </dt><dd className="inline tabular">{at ? <time dateTime={at}>{pragueDateTime(at, lang)}</time> : <time dateTime={post.scheduledAt}>{pragueDateTime(post.scheduledAt, lang)}</time>}</dd></div>
              <div><dt className="inline">{t.published.account}: </dt><dd className="inline">@{post.account.handle}</dd></div>
            </dl>
            {post.publication?.remoteUrl ? <a href={post.publication.remoteUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded text-xs text-information underline focus-ring md:min-h-6">{t.published.open}<ExternalLink className="size-3.5" aria-hidden /></a>
              : <p className="text-xs text-foreground-muted">{t.published.noLink}</p>}
            <DneskaiDetails lang={lang} rows={[[t.detailPublication, post.publication?.id], [t.detailRevision, post.id], [t.detailHash, post.contentHash], [t.detailTrace, post.traceId]]} />
          </div>
        </li>;
      })}</ul>}
  </section>;
}
