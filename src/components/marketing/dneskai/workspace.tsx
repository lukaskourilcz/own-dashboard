'use client';

import { useQuery } from '@tanstack/react-query';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys } from '@/lib/marketing/dneskai-workspace-client';
import { DneskaiReviewTab } from './review-tab';
import { DneskaiCalendarTab } from './calendar-tab';
import { DneskaiPublishedTab } from './published-tab';
import { DneskaiCostsTab } from './costs-tab';

export type DneskaiWorkspaceTabId = 'dneskai-review' | 'dneskai-calendar' | 'dneskai-published' | 'dneskai-costs';
type Lang = 'en' | 'cs';
const options = { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } as const;

/**
 * One DNESKAi workspace tab (#119). Loaded only when the tab opens: Today, Calendar and Published share the review
 * read; Errors and costs has its own. In the preview the reads come from the in-memory demo, never from a server.
 */
export function DneskaiWorkspaceTab({ tab, projectId, lang, preview = false }: { tab: DneskaiWorkspaceTabId; projectId: string; lang: Lang; preview?: boolean }) {
  return tab === 'dneskai-costs' ? <CostsTab projectId={projectId} lang={lang} preview={preview} /> : <ReviewRead tab={tab} projectId={projectId} lang={lang} preview={preview} />;
}

function ReviewRead({ tab, projectId, lang, preview }: { tab: Exclude<DneskaiWorkspaceTabId, 'dneskai-costs'>; projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiWorkspace[lang];
  const query = useQuery({ queryKey: dneskaiWorkspaceKeys(projectId).review, ...options,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadReview(projectId, signal) });
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  const props = { read: query.data, lang, preview, refreshing: query.isFetching, onRefresh: () => void query.refetch() };
  return tab === 'dneskai-review' ? <DneskaiReviewTab {...props} projectId={projectId} /> : tab === 'dneskai-calendar' ? <DneskaiCalendarTab {...props} /> : <DneskaiPublishedTab {...props} />;
}

function CostsTab({ projectId, lang, preview }: { projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiWorkspace[lang];
  const query = useQuery({ queryKey: dneskaiWorkspaceKeys(projectId).costs, ...options,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadCosts(projectId, signal) });
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  return <DneskaiCostsTab read={query.data} lang={lang} preview={preview} refreshing={query.isFetching} onRefresh={() => void query.refetch()} />;
}
