'use client';

import { useCallback, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys } from '@/lib/marketing/dneskai-workspace-client';
import { dneskaiAwaitingRender, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiLabTab } from './lab/lab-tab';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { Button } from '@/components/ui/button';
import { DneskaiReviewTab } from './review-tab';
import { DneskaiCalendarTab } from './calendar-tab';
import { DneskaiPublishedTab } from './published-tab';
import { DneskaiCostsTab } from './costs-tab';
import type { DneskaiProjectTab } from '@/lib/project-workspace-tabs';

export type DneskaiWorkspaceTabId = DneskaiProjectTab;
type Lang = 'en' | 'cs';
const options = { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } as const;
/** While a post waits for its render, read again every 30 s until it attaches or reads as failed. */
const AWAITING_RENDER_POLL_MS = 30_000;

function useReviewRead(projectId: string, preview: boolean) {
  return useQuery<DneskaiWorkspaceRead>({ queryKey: dneskaiWorkspaceKeys(projectId).review, ...options,
    refetchInterval: (query) => query.state.data && dneskaiAwaitingRender(query.state.data) ? AWAITING_RENDER_POLL_MS : false,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadReview(projectId, signal) });
}

/**
 * The versions this session saw fail to attach their render (502 render-attach-failed with the saved id). Nothing is
 * stored for them, so the set lives in the query cache: every tab and every tab switch reads it as a problem at once.
 */
function useRenderFailed(projectId: string) {
  const queryClient = useQueryClient();
  const key = dneskaiWorkspaceKeys(projectId).renderFailed;
  const { data } = useQuery<ReadonlySet<string>>({ queryKey: key, initialData: () => new Set(), staleTime: Infinity, gcTime: Infinity,
    queryFn: () => queryClient.getQueryData<ReadonlySet<string>>(key) ?? new Set() });
  const add = useCallback((id: string) => {
    queryClient.setQueryData<ReadonlySet<string>>(dneskaiWorkspaceKeys(projectId).renderFailed, (current) => new Set(current).add(id));
  }, [queryClient, projectId]);
  return [data, add] as const;
}

/**
 * One DNESKAi workspace tab (#119). Loaded only when the tab opens: Today, Calendar and Published share the review
 * read; Errors and costs has its own. In the preview the reads come from the in-memory demo, never from a server.
 */
/** `onOpenSources` lets the Design Lab queue point to the owner recovery actions in Sources (C3, briefs-07). */
export function DneskaiWorkspaceTab({ tab, projectId, lang, preview = false, onOpenSources }: { tab: DneskaiWorkspaceTabId; projectId: string; lang: Lang; preview?: boolean; onOpenSources?: () => void }) {
  return tab === 'dneskai-costs' ? <CostsTab projectId={projectId} lang={lang} preview={preview} /> : <ReviewRead tab={tab} projectId={projectId} lang={lang} preview={preview} onOpenSources={onOpenSources} />;
}

function ReviewRead({ tab, projectId, lang, preview, onOpenSources }: { tab: Exclude<DneskaiWorkspaceTabId, 'dneskai-costs'>; projectId: string; lang: Lang; preview: boolean; onOpenSources?: () => void }) {
  const t = dneskaiWorkspace[lang];
  const pathname = usePathname();
  const guest = preview && pathname === '/guest';
  const query = useReviewRead(projectId, preview);
  const [renderFailed, addRenderFailed] = useRenderFailed(projectId);
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  const props = { read: query.data, lang, preview, refreshing: query.isFetching, onRefresh: () => void query.refetch() };
  return tab === 'dneskai-review' ? <ReviewExperience {...props} guest={guest} onOpenSources={onOpenSources} projectId={projectId} renderFailed={renderFailed} addRenderFailed={addRenderFailed} />
    : tab === 'dneskai-calendar' ? <DneskaiCalendarTab {...props} renderFailed={renderFailed} /> : <DneskaiPublishedTab {...props} />;
}

function CostsTab({ projectId, lang, preview }: { projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiWorkspace[lang];
  const query = useQuery({ queryKey: dneskaiWorkspaceKeys(projectId).costs, ...options,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadCosts(projectId, signal) });
  // The posts that cannot be approved come from the review read, shared with the other tabs.
  const review = useReviewRead(projectId, preview);
  const [renderFailed] = useRenderFailed(projectId);
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  return <DneskaiCostsTab read={query.data} review={review.isPending ? 'loading' : review.isError ? 'unavailable' : review.data} renderFailed={renderFailed} lang={lang} preview={preview}
    refreshing={query.isFetching || review.isFetching} onRefresh={() => { void query.refetch(); void review.refetch(); }} />;
}

function ReviewExperience({ guest, onOpenSources, ...props }: Parameters<typeof DneskaiReviewTab>[0] & { guest: boolean; onOpenSources?: () => void }) {
  const [view, setView] = useState<'lab' | 'list'>('lab');
  const [dirty, setDirty] = useState(false);
  const t = dneskaiLab[props.lang];
  return <div className="space-y-4"><div role="group" aria-label={t.views.label} className="flex gap-1">
    {(['lab', 'list'] as const).map((item) => <Button key={item} variant={view === item ? 'subtle' : 'ghost'} size="sm" aria-pressed={view === item} disabled={(dirty && view !== item) || (guest && item === 'list')} onClick={() => setView(item)}>{t.views[item]}</Button>)}
  </div>{view === 'lab' ? <DneskaiLabTab {...props} guest={guest} onDirtyChange={setDirty} onOpenSources={onOpenSources} /> : <DneskaiReviewTab {...props} />}</div>;
}
