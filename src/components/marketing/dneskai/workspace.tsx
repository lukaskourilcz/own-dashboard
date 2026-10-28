'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGuardedNavigation } from '@/components/navigation-guard';
import { DneskaiDecisionCursorSchema, type DneskaiDecisionCursor } from '@/lib/marketing/dneskai-workspace';
import { usePathname } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiWorkspaceApi, dneskaiWorkspaceKeys } from '@/lib/marketing/dneskai-workspace-client';
import { dneskaiAwaitingRender, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiLabTab } from './lab/lab-tab';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { DneskaiCalendarTab } from './calendar-tab';
import { DneskaiPublishedTab } from './published-tab';
import { DneskaiCostsTab } from './costs-tab';
import type { DneskaiProjectTab } from '@/lib/project-workspace-tabs';

export type DneskaiWorkspaceTabId = DneskaiProjectTab;
type Lang = 'en' | 'cs';
const options = { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } as const;
/** While a post waits for its render, read again every 30 s until it attaches or reads as failed. */
const AWAITING_RENDER_POLL_MS = 30_000;

function useReviewRead(projectId: string, preview: boolean, before: DneskaiDecisionCursor | null = null) {
  return useQuery<DneskaiWorkspaceRead>({ queryKey: before ? dneskaiWorkspaceKeys(projectId).reviewPage(before) : dneskaiWorkspaceKeys(projectId).review, ...options,
    refetchInterval: (query) => query.state.status !== 'error' && query.state.data && dneskaiAwaitingRender(query.state.data) ? AWAITING_RENDER_POLL_MS : false,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadReview(projectId, signal, before ?? undefined) });
}

/** Keep one explicit read in flight and restore focus after replacing its retry row. */
function useReadRecovery(data: unknown, fetching: boolean, refetch: () => Promise<unknown>) {
  const container = useRef<HTMLDivElement>(null), focusAfter = useRef(false), pending = useRef(false);
  useLayoutEffect(() => {
    if (!focusAfter.current || fetching && data === undefined) return;
    const active = document.activeElement;
    // Removing Retry can leave focus on the dialog trap's fallback container.
    const dialog = container.current?.closest('[role="dialog"]');
    if (active !== document.body && active !== dialog && !(active instanceof HTMLElement && active.hasAttribute('data-dneskai-read-retry'))) { focusAfter.current = false; return; }
    const target = container.current?.querySelector<HTMLElement>(data === undefined ? '[data-dneskai-read-retry]' : '[data-testid="dneskai-lab-refresh"], h2[tabindex="-1"]');
    if (target && !target.hasAttribute('disabled')) { focusAfter.current = false; target.focus(); }
  }, [data, fetching]);
  const reload = () => {
    if (pending.current) return;
    focusAfter.current = document.activeElement instanceof HTMLElement && document.activeElement.hasAttribute('data-dneskai-read-retry');
    pending.current = true;
    void refetch().then(() => { pending.current = false; }, () => { pending.current = false; });
  };
  return [container, reload] as const;
}
function ReadFailure({ message, lang, refreshing, onRefresh }: { message: string; lang: Lang; refreshing: boolean; onRefresh: () => void }) {
  const t = dneskaiWorkspace[lang];
  return <div className="mx-auto flex w-fit max-w-full flex-col gap-3 sm:flex-row sm:items-center" data-testid="dneskai-read-recovery"><p role="alert" className="min-w-0 text-sm text-risk">{message}</p><Button data-dneskai-read-retry variant="outline" className="min-h-11 w-full shrink-0 sm:w-40" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>{refreshing ? t.refreshing : t.refresh}</Button></div>;
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
 * One DNESKAi workspace tab (#119). Loaded only when the tab opens: Today, Calendar and Posts share the review
 * read; Errors and costs has its own. In the preview the reads come from the in-memory demo, never from a server.
 */
export function DneskaiWorkspaceTab({ tab, projectId, lang, preview = false, liveMusic = false }: { tab: DneskaiWorkspaceTabId; projectId: string; lang: Lang; preview?: boolean; liveMusic?: boolean }) {
  return tab === 'dneskai-costs' ? <CostsTab projectId={projectId} lang={lang} preview={preview} /> : <ReviewRead key={projectId} tab={tab} projectId={projectId} lang={lang} preview={preview} liveMusic={liveMusic} />;
}

function ReviewRead({ tab, projectId, lang, preview, liveMusic }: { tab: Exclude<DneskaiWorkspaceTabId, 'dneskai-costs'>; projectId: string; lang: Lang; preview: boolean; liveMusic: boolean }) {
  const t = dneskaiWorkspace[lang];
  const pathname = usePathname();
  const guest = preview && pathname === '/guest';
  const [pages, setPages] = useState<DneskaiDecisionCursor[]>(() => {
    if (typeof window === 'undefined') return [];
    try { const raw = new URLSearchParams(window.location.search).get('reviewBefore'); return raw ? [DneskaiDecisionCursorSchema.parse(JSON.parse(raw))] : []; }
    catch { return []; }
  });
  const changePages = (next: DneskaiDecisionCursor[]) => {
    setPages(next);
    const url = new URL(window.location.href);
    if (next.length) url.searchParams.set('reviewBefore', JSON.stringify(next.at(-1))); else url.searchParams.delete('reviewBefore');
    window.history.replaceState(window.history.state, '', url);
  };
  const requestNavigation = useGuardedNavigation();
  const query = useReviewRead(projectId, preview, pages.at(-1) ?? null);
  const [renderFailed, addRenderFailed] = useRenderFailed(projectId);
  const [readContainer, reload] = useReadRecovery(query.data, query.isFetching, () => query.refetch());
  const read = query.data;
  if (read === undefined) return <div ref={readContainer}>{query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p> : <ReadFailure message={t.unavailable} lang={lang} refreshing={query.isFetching} onRefresh={reload}/>}</div>;
  const props = { read, lang, preview, refreshing: query.isFetching, onRefresh: reload };
  const next = read.decisionPage?.nextCursor;
  return <div ref={readContainer} className="min-w-0 space-y-4" data-testid="dneskai-workspace-read">
    {query.isError && <p role="alert" className="text-sm text-warning" data-testid="dneskai-cached-read">{t.cachedUnavailable}</p>}
    {(next || pages.length > 0) && <nav aria-label={t.decisions.label} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" disabled={!pages.length || query.isFetching} onClick={() => requestNavigation(() => changePages(pages.slice(0, -1)))}>{t.decisions.newer}</Button>
        <span className="text-xs text-foreground-muted">{t.decisions.page(pages.length + 1)}</span>
        <Button variant="outline" size="sm" disabled={!next || query.isFetching} onClick={() => { if (next) requestNavigation(() => changePages([...pages, next])); }}>{t.decisions.older}</Button>
      </div><p className="text-xs text-foreground-muted">{t.decisions.context}</p>
    </nav>}
    {tab === 'dneskai-review' ? <ReviewExperience {...props} liveMusic={liveMusic} onSavedRevision={() => changePages([])} guest={guest} projectId={projectId} renderFailed={renderFailed} addRenderFailed={addRenderFailed} />
      : tab === 'dneskai-calendar' ? <DneskaiCalendarTab {...props} renderFailed={renderFailed} /> : <DneskaiPublishedTab {...props} renderFailed={renderFailed} />}
  </div>;
}

function CostsTab({ projectId, lang, preview }: { projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiWorkspace[lang];
  const query = useQuery({ queryKey: dneskaiWorkspaceKeys(projectId).costs, ...options,
    queryFn: async ({ signal }) => (await dneskaiWorkspaceApi(preview)).loadCosts(projectId, signal) });
  // The posts that cannot be approved come from the review read, shared with the other tabs.
  const review = useReviewRead(projectId, preview);
  const [renderFailed] = useRenderFailed(projectId);
  const refreshing = query.isFetching || review.isFetching;
  const [readContainer, reload] = useReadRecovery(query.data, refreshing, () => Promise.all([query.refetch(), review.refetch()]));
  if (query.data === undefined) return <div ref={readContainer}>{query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.costs.loading}</p> : <ReadFailure message={t.costs.unavailable} lang={lang} refreshing={refreshing} onRefresh={reload}/>}</div>;
  return <div ref={readContainer} className="min-w-0 space-y-4" data-testid="dneskai-costs-read">
    {(query.isError || review.isError && review.data !== undefined) && <p role="alert" className="text-sm text-warning" data-testid="dneskai-cached-read">{t.cachedUnavailable}</p>}
    <DneskaiCostsTab read={query.data} review={review.data ?? (review.isPending ? 'loading' : 'unavailable')} renderFailed={renderFailed} lang={lang} preview={preview}
      refreshing={refreshing} onRefresh={reload} />
  </div>;
}

type LabProps = Omit<Parameters<typeof DneskaiLabTab>[0], 'guest'>;
const CHANNELS = ['instagram', 'threads', 'linkedin'] as const;

/**
 * „Dnes ke schválení“ by channel (#170): Instagram opens the Design Lab; Threads and LinkedIn have no connected
 * account yet and stay disabled with a tooltip that says so. Threads publishing is tracked in issue #124.
 */
function ReviewExperience({ guest, ...props }: LabProps & { guest: boolean }) {
  const t = dneskaiLab[props.lang].channels;
  return <div className="min-w-0 space-y-4" data-testid="dneskai-review">
    <div role="group" aria-label={t.label} className="inline-flex rounded-md border border-border bg-surface-secondary p-0.5" data-testid="dneskai-channels">
      {CHANNELS.map((channel) => channel === 'instagram'
        ? <Button key={channel} variant="subtle" size="sm" aria-pressed="true">{t[channel]}</Button>
        // aria-disabled, not disabled: the button stays focusable so keyboard users reach the tooltip.
        : <Tooltip key={channel} content={t.notConnected}><Button variant="ghost" size="sm" aria-pressed="false" aria-disabled="true" aria-describedby={`dneskai-channel-${channel}-note`}
            className="cursor-not-allowed opacity-50 hover:bg-transparent hover:text-foreground-muted" onClick={(event) => event.preventDefault()}>
            {t[channel]}</Button></Tooltip>)}
      {CHANNELS.slice(1).map((channel) => <span key={channel} id={`dneskai-channel-${channel}-note`} hidden>{t.notConnected}</span>)}
    </div>
    <DneskaiLabTab {...props} guest={guest} />
  </div>;
}
