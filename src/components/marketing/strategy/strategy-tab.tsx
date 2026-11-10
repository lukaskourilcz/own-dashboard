'use client';

import { useId, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpRight, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EntityBadge } from '@/components/ui/status-badge';
import { marketingStrategy as copy } from '@/lib/i18n/sections/marketing-strategy';
import { qk } from '@/lib/queries/keys';
import { publishingTargetHref, versionLive, type PublishingBrand, type PublishingCalendar } from '@/lib/publishing-calendar';
import { growthResearch, strategyBrief, strategyIdeas, type StrategyIdea, type StrategyLang } from '@/lib/marketing/strategy/content';
import { addStrategyIdea, loadStrategy, loadStrategyCalendar, openStrategyHref, strategyKey } from '@/lib/marketing/strategy/client';
import type { StrategyRead } from '@/lib/marketing/strategy/contracts';
import { cn } from '@/lib/utils';
import { StrategyResults } from './strategy-results';

type Props = { brand: PublishingBrand; projectId: string; projectSlug: string; lang: StrategyLang; preview?: boolean };
type Section = keyof (typeof copy)['en']['sections'];
const options = { staleTime: 30_000, retry: false, refetchOnWindowFocus: false } as const;
const names = { devshark: 'devShark', dneskai: 'DNESKAi' };

export function MarketingStrategyTab({ brand, projectId, projectSlug, lang, preview = false }: Props) {
  const t = copy[lang];
  const research = growthResearch.brands[brand];
  const [section, setSection] = useState<Section>('overview');
  const ids = useId();
  const query = useQuery({ queryKey: strategyKey(projectId, brand, preview), ...options,
    queryFn: async ({ signal }) => preview
      ? (await import('@/lib/demo/marketing-strategy-demo')).demoMarketingStrategy.load(projectId, brand)
      : loadStrategy(projectId, brand, signal) });
  const calendar = useQuery({ queryKey: preview ? [...qk.publishingCalendar, 'preview'] : qk.publishingCalendar, ...options,
    queryFn: async ({ signal }) => preview
      ? (await import('@/lib/demo/publishing-calendar-demo')).previewPublishingCalendar()
      : loadStrategyCalendar(signal) });
  const projectHref = (tab: string) => `/projects/${encodeURIComponent(projectSlug)}?projectTab=${tab}`;
  const go = (href: string) => openStrategyHref(href);
  const actions = [
    [t.calendar, '/schedule'], [t.lab, projectHref(brand === 'devshark' ? 'devshark-studio' : 'dneskai-review')],
    ...(brand === 'dneskai' ? [[t.topics, '/topics'], [t.sources, projectHref('sources')]] : []),
    [t.competition, projectHref('competition')], [t.knowledge, projectHref('knowledge')], [t.tips, '/ig-tips'],
    [t.finance, projectHref(brand === 'dneskai' ? 'dneskai-costs' : 'finance')],
  ];
  return <section className="min-w-0 space-y-5" data-testid="marketing-strategy" aria-labelledby={`${ids}-title`}>
    <header className="space-y-2">
      <div className="flex flex-wrap items-center gap-2"><h2 id={`${ids}-title`} className="text-base font-semibold">{names[brand]} · {t.title}</h2><EntityBadge>{t.updated}: {growthResearch.reviewedAt}</EntityBadge></div>
      {preview && <p className="text-xs text-foreground-muted">{t.preview}</p>}
      <nav aria-label={t.workflow} className="flex flex-wrap gap-2">{actions.map(([label, href]) => <Button key={href} variant="outline" size="sm" onClick={() => go(href)}>{label}<ArrowUpRight aria-hidden className="size-3.5" /></Button>)}</nav>
    </header>
    <div role="group" aria-label={t.tab} className="flex flex-wrap gap-1 border-b border-border pb-2">{(Object.keys(t.sections) as Section[]).map((id) => <Button key={id} aria-pressed={section === id} variant={section === id ? 'subtle' : 'ghost'} size="sm" onClick={() => setSection(id)}>{t.sections[id]}</Button>)}</div>
    {(query.isPending || calendar.isPending) && <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>}
    {(query.isError || calendar.isError || calendar.data?.unavailable.includes(brand)) && <div role="alert" className="space-y-2 rounded-md border border-warning/40 bg-warning-soft p-3 text-sm"><p>{t.unavailable}</p><Button variant="outline" size="sm" onClick={() => { void query.refetch(); void calendar.refetch(); }}>{t.retry}</Button></div>}
    {section === 'overview' && <div className="space-y-6">
      <Block title={t.goal}><p>{research.positioning[lang]}</p></Block>
      <Block title={t.audit}><ul className="list-disc space-y-2 pl-5">{research.audit.map((item, index) => <li key={index}>{item[lang]}</li>)}</ul></Block>
      <Block title={t.mix}>
        <p className="text-foreground-muted">{t.mixHelp}</p>
        <ul className="mt-3 space-y-3">{research.pillars.map((p, i) => <li key={i}><p className="flex justify-between gap-3"><span>{p.label[lang]}</span><span className="tabular-nums">{p.percent}%</span></p><div aria-hidden className="mt-1 h-1.5 rounded-sm bg-surface-inset"><div className="h-full rounded-sm bg-primary" style={{ width: `${p.percent}%` }} /></div></li>)}</ul>
      </Block>
      <Block title={t.profile}><p>{research.profile[lang]}</p></Block>
      <Block title={t.cadence}><p>{research.cadence[lang]}</p><p className="mt-2 text-foreground-muted">{growthResearch.common.cadence[lang]}</p></Block>
      <ConnectedPlan calendar={calendar.data} brand={brand} lang={lang} />
      <Block title={t.workflow}><p>{growthResearch.common.workflow[lang]}</p></Block>
      <Block title={t.formats}><p>{growthResearch.common.production[lang]}</p><ul className="mt-3 list-disc space-y-2 pl-5">{research.formats.map((item, i) => <li key={i}>{item[lang]}</li>)}</ul></Block>
      <Block title={t.routine}><p>{growthResearch.common.routine[lang]}</p></Block>
      <Block title={t.roadmap}><ol className="divide-y divide-border">{growthResearch.phases.map((phase) => <li key={phase.days} className="py-3"><h4 className="font-semibold">{phase.days} · {phase.title[lang]}</h4><p className="mt-1 text-foreground-muted">{phase.body[lang]}</p></li>)}</ol></Block>
    </div>}
    {section === 'ideas' && <div className="space-y-3"><p className="text-sm text-foreground-muted">{t.ideaHelp}</p><ol className="divide-y divide-border">{strategyIdeas(brand).map((idea, index) => <Idea key={idea.id} {...{ idea, index, lang, brand, projectId, projectSlug, preview }} read={query.data} unavailable={query.isError || query.isPending} />)}</ol></div>}
    {section === 'experiments' && <div className="space-y-5"><p className="text-sm text-foreground-muted">{t.experimentHelp}</p><Block title={t.rules}><p>{growthResearch.common.decision[lang]}</p></Block>{research.experiments.map((exp) => <Block key={exp.id} title={exp.title[lang]}><dl className="space-y-2"><div><dt className="font-medium">{t.variantA}</dt><dd>{exp.a[lang]}</dd></div><div><dt className="font-medium">{t.variantB}</dt><dd>{exp.b[lang]}</dd></div><div><dt className="font-medium">{t.metric}</dt><dd>{t.metrics[exp.metric as 'shares' | 'saves' | 'replies']} / 1 000 · {exp.channel === 'threads' ? t.metrics.views : t.metrics.reach}</dd></div></dl></Block>)}</div>}
    {section === 'results' && <StrategyResults {...{ brand, projectId, lang, preview }} read={query.data} unavailable={query.isError || query.isPending} />}
    {section === 'research' && <div className="space-y-5">
      <Block title={t.research}><p>{growthResearch.common.boundary[lang]}</p><p className="mt-3">{growthResearch.common.screenshots[lang]}</p><p className="mt-3 text-foreground-muted">{t.sourcesHelp}</p></Block>
      <Block title={t.references}><p>{growthResearch.common.competitors[lang]}</p></Block>
      <ul className="divide-y divide-border">{growthResearch.sources.filter((s) => s.kind === 'platform' || research.references.includes(s.id)).map((s) => <li key={s.id} className="py-3 text-sm"><a href={s.url} target="_blank" rel="noreferrer" className="focus-ring break-words font-medium underline underline-offset-4">{s.title}</a><p className="mt-2 leading-relaxed text-foreground-muted">{s.finding[lang]}</p></li>)}</ul>
    </div>}
  </section>;
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return <section className="min-w-0 border-t border-border pt-4"><h3 className="mb-2 text-sm font-semibold">{title}</h3><div className="space-y-2 break-words text-sm leading-relaxed">{children}</div></section>;
}

function ConnectedPlan({ calendar, brand, lang }: { calendar?: PublishingCalendar; brand: PublishingBrand; lang: StrategyLang }) {
  const t = copy[lang];
  const posts = calendar?.posts.filter((post) => post.brand === brand) ?? [];
  const status = (s: string) => s === 'published' ? t.published : s === 'failed' ? t.failedStatus : s === 'reconciliation' ? t.reconciliation : t.waiting;
  return <Block title={t.upcoming}><p className="text-foreground-muted">{t.upcomingHelp}</p>{calendar && posts.length === 0 && <p>{t.noUpcoming}</p>}
    <ul className="divide-y divide-border">{posts.slice(0, 30).map((post) => <li key={post.id} className="min-w-0 py-3">
      <p className="font-medium"><time dateTime={post.scheduledAt}>{post.date} · {post.time}</time> · {post.title}</p>
      <div className="mt-2 flex flex-wrap gap-2">{post.versions.map((v) => <Button key={v.channel} variant="outline" size="sm" disabled={!post.target} onClick={() => post.target && openStrategyHref(publishingTargetHref(post.target, v.channel))}>
        {t.versions[v.channel]} · {versionLive(post, v) ? status(v.status) : t.off}<ArrowUpRight aria-hidden className="size-3" />
      </Button>)}</div>
    </li>)}</ul>
  </Block>;
}

function Idea({ idea, index, lang, brand, projectId, projectSlug, preview, read, unavailable }: Props & { idea: StrategyIdea; index: number; read?: StrategyRead; unavailable: boolean }) {
  const t = copy[lang];
  const cache = useQueryClient();
  const [notice, setNotice] = useState('');
  const [showBrief, setShowBrief] = useState(false);
  const linked = read?.links.find((item) => item.idea_id === idea.id);
  const add = useMutation({ mutationFn: () => preview
    ? import('@/lib/demo/marketing-strategy-demo').then((m) => m.demoMarketingStrategy.add(projectId, brand, idea.id))
    : addStrategyIdea(projectId, brand, idea.id),
    onSuccess: async () => {
      setNotice(t.added);
      await Promise.all([cache.invalidateQueries({ queryKey: qk.marketingStrategy }), cache.invalidateQueries({ queryKey: qk.devsharkDrafts }), cache.invalidateQueries({ queryKey: qk.dneskaiTopics })]);
    }, onError: () => setNotice(t.addFailed),
  });
  return <li className="min-w-0 py-4">
    <details><summary className="focus-ring min-h-11 cursor-pointer py-2 text-sm font-semibold">{index + 1}. {idea.title}</summary>
      <dl className="mt-2 space-y-3 text-sm leading-relaxed"><div><dt className="font-medium">{t.appeal}</dt><dd className="text-foreground-muted">{idea.appeal[lang]}</dd></div><div><dt className="font-medium">{t.visual}</dt><dd className="text-foreground-muted">{idea.visual[lang]}</dd></div><div><dt className="font-medium">{t.threads}</dt><dd className="text-foreground-muted" lang={brand === 'devshark' ? 'en' : 'cs'}>{idea.threads}</dd></div><div><dt className="font-medium">{t.evidence}</dt><dd><a href={idea.sourceUrl} target="_blank" rel="noreferrer" className="focus-ring break-all underline underline-offset-4">{idea.sourceUrl}</a></dd></div></dl>
    </details>
    <div className="mt-2 flex flex-wrap gap-2">
      {linked ? <Button variant="outline" size="sm" onClick={() => openStrategyHref(linked.draft_id ? `/projects/${encodeURIComponent(projectSlug)}?projectTab=devshark-studio&studioDraft=${linked.draft_id}` : '/topics')}>{linked.draft_id ? t.openDraft : t.openTopic}<ArrowUpRight aria-hidden className="size-3.5" /></Button>
        : <Button size="sm" variant="outline" disabled={unavailable || add.isPending} aria-busy={add.isPending} onClick={() => add.mutate()}>{add.isPending ? t.adding : brand === 'devshark' ? t.add : t.addTopic}</Button>}
      <Button size="sm" variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(strategyBrief(idea, lang)); setNotice(t.copied); } catch { setShowBrief(true); setNotice(t.copyFailed); } }}><Copy aria-hidden className="size-3.5" />{t.copy}</Button>
    </div>
    {showBrief && <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{strategyBrief(idea, lang)}</pre>}
    {notice && <p role={add.isError ? 'alert' : 'status'} className={cn('mt-2 text-xs', add.isError ? 'text-risk' : 'text-foreground-muted')}>{notice}</p>}
  </li>;
}
