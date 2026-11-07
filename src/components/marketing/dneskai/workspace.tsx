'use client';

import { useCallback } from 'react';
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
import { DneskaiTodayTab } from './today-tab';
import { dneskaiToday } from '@/lib/i18n/sections/dneskai-today';
import { dneskaiPlanApi, dneskaiPlanKey } from '@/lib/marketing/dneskai-plan-client';
import type { DneskaiPlanRead } from '@/lib/marketing/dneskai-plan-view';
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
 * One DNESKAi workspace tab (#119). Loaded only when the tab opens: Review, Calendar and Posts share the review
 * read; Errors and costs and Today and tomorrow (the plan read) have their own. In the preview the reads come from the in-memory demo, never from a server.
 */
export function DneskaiWorkspaceTab({ tab, projectId, lang, preview = false }: { tab: DneskaiWorkspaceTabId; projectId: string; lang: Lang; preview?: boolean }) {
  return tab === 'dneskai-costs' ? <CostsTab projectId={projectId} lang={lang} preview={preview} />
    : tab === 'dneskai-today' ? <TodayTab lang={lang} preview={preview} />
    : <ReviewRead tab={tab} projectId={projectId} lang={lang} preview={preview} />;
}

/** While a slot of the plan is being prepared, read again every minute until it is ready or failed. */
const PLAN_PREPARING_POLL_MS = 60_000;
const preparing = (read: DneskaiPlanRead | undefined) => !!read?.slots.some((slot) => slot.status === 'generating');

/** „Dnes a zítra“: the two-day plan read first, the 30-day plan beside it; neither reads the review. */
function TodayTab({ lang, preview }: { lang: Lang; preview: boolean }) {
  const t = dneskaiToday[lang];
  const twoDays = useQuery<DneskaiPlanRead>({ queryKey: dneskaiPlanKey(), ...options,
    refetchInterval: (query) => preparing(query.state.data) ? PLAN_PREPARING_POLL_MS : false,
    queryFn: async ({ signal }) => (await dneskaiPlanApi(preview)).load({}, signal) });
  const month = useQuery<DneskaiPlanRead>({ queryKey: dneskaiPlanKey({ days: 30 }), ...options,
    queryFn: async ({ signal }) => (await dneskaiPlanApi(preview)).load({ days: 30 }, signal) });
  if (twoDays.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (twoDays.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  return <DneskaiTodayTab read={twoDays.data} month={month.isPending ? 'loading' : month.isError ? 'unavailable' : month.data} lang={lang} preview={preview}
    refreshing={twoDays.isFetching || month.isFetching} onRefresh={() => { void twoDays.refetch(); void month.refetch(); }} />;
}

function ReviewRead({ tab, projectId, lang, preview }: { tab: Exclude<DneskaiWorkspaceTabId, 'dneskai-costs' | 'dneskai-today'>; projectId: string; lang: Lang; preview: boolean }) {
  const t = dneskaiWorkspace[lang];
  const pathname = usePathname();
  const guest = preview && pathname === '/guest';
  const query = useReviewRead(projectId, preview);
  const [renderFailed, addRenderFailed] = useRenderFailed(projectId);
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <p role="alert" className="text-sm text-risk">{t.unavailable}</p>;
  const props = { read: query.data, lang, preview, refreshing: query.isFetching, onRefresh: () => void query.refetch() };
  return tab === 'dneskai-review' ? <ReviewExperience {...props} guest={guest} projectId={projectId} renderFailed={renderFailed} addRenderFailed={addRenderFailed} />
    : tab === 'dneskai-calendar' ? <DneskaiCalendarTab {...props} renderFailed={renderFailed} /> : <DneskaiPublishedTab {...props} renderFailed={renderFailed} />;
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

type LabProps = Omit<Parameters<typeof DneskaiLabTab>[0], 'guest' | 'onDirtyChange'>;
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
