'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { qk } from '@/lib/queries/keys';
import { marketingStrategy as copy } from '@/lib/i18n/sections/marketing-strategy';
import { growthResearch, type StrategyLang } from '@/lib/marketing/strategy/content';
import { saveStrategyResult } from '@/lib/marketing/strategy/client';
import { STRATEGY_METRICS, StrategyResultInputSchema, strategyAgeWindow, strategyComparison, strategyRate, type StrategyRead, type StrategyResultInput } from '@/lib/marketing/strategy/contracts';
import type { PublishingBrand } from '@/lib/publishing-calendar';

type Props = { brand: PublishingBrand; projectId: string; lang: StrategyLang; preview: boolean; read?: StrategyRead; unavailable: boolean };
const field = 'min-h-11 w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-ring';
const emptyMetrics = () => Object.fromEntries(STRATEGY_METRICS.map((key) => [key, ''])) as Record<(typeof STRATEGY_METRICS)[number], string>;

export function StrategyResults({ brand, projectId, lang, preview, read, unavailable }: Props) {
  const t = copy[lang];
  const ids = useId();
  const cache = useQueryClient();
  const [publicationId, setPublication] = useState('');
  const [publishedAt, setPublished] = useState('');
  const [observedAt, setObserved] = useState('');
  const [experiment, setExperiment] = useState<'baseline' | 'hook' | 'threads' | 'story'>('baseline');
  const [variant, setVariant] = useState<'A' | 'B'>('A');
  const [evidence, setEvidence] = useState('');
  const [metrics, setMetrics] = useState(emptyMetrics);
  const [notice, setNotice] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [comparisonExperiment, setComparisonExperiment] = useState('hook');
  const [window, setWindow] = useState<'72h' | '7d' | '24h'>('72h');
  const experiments = growthResearch.brands[brand].experiments;
  const publications = read?.publications ?? [];
  const posts = new Map(publications.map((p) => [p.id, p]));
  const comparisons = read ? strategyComparison(read, comparisonExperiment, window, brand) : [];
  const biggest = Math.max(1, ...comparisons.map((row) => row.median));
  const number = (value: number | null) => value === null ? t.unknown : new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { maximumFractionDigits: 2 }).format(value);
  const save = useMutation({ mutationFn: (input: StrategyResultInput) => preview
    ? import('@/lib/demo/marketing-strategy-demo').then((m) => m.demoMarketingStrategy.save(input)) : saveStrategyResult(input),
    onSuccess: async () => { setNotice(t.saved); setMetrics(emptyMetrics()); await cache.invalidateQueries({ queryKey: qk.marketingStrategy }); },
    onError: () => setNotice(t.failed),
  });
  const submit = (event: FormEvent) => {
    event.preventDefault(); setNotice(''); setInvalid(false);
    const published = new Date(publishedAt), observed = new Date(observedAt);
    if (!Number.isFinite(published.getTime()) || !Number.isFinite(observed.getTime())) { setInvalid(true); setNotice(t.invalid); return; }
    const parsed = StrategyResultInputSchema.safeParse({ projectId, brand, publicationId, publishedAt: published.toISOString(), observedAt: observed.toISOString(), experiment, variant, evidence,
      metrics: Object.fromEntries(STRATEGY_METRICS.map((key) => [key, metrics[key].trim() === '' ? null : Number(metrics[key])])) });
    if (!parsed.success || !posts.has(publicationId) || observed.getTime() > Date.now() + 300_000) { setInvalid(true); setNotice(t.invalid); return; }
    save.mutate(parsed.data);
  };
  const exportResults = () => {
    const blob = new Blob([JSON.stringify({ brand, projectId, exportedAt: new Date().toISOString(), coverage: 'bounded-manual-native-insights', results: read?.results ?? [], publications }, null, 2)], { type: 'application/json' });
    const href = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = href; link.download = `${brand}-strategy-results.json`; link.click(); URL.revokeObjectURL(href);
  };
  return <div className="min-w-0 space-y-6" data-testid="strategy-results">
    <p className="text-sm leading-relaxed text-foreground-muted">{t.resultHelp}</p>
    <p className="text-sm leading-relaxed">{growthResearch.common.measurement[lang]}</p>
    {read?.partial && <p className="text-xs text-foreground-muted">{t.partial}</p>}
    {read && read.results.length === 0 && <p className="rounded-md border border-border bg-surface-inset p-3 text-sm">{t.emptyResults}</p>}
    {read && publications.length === 0 && <p className="text-sm text-foreground-muted">{t.noPublications}</p>}
    {publications.length > 0 && <form onSubmit={submit} aria-describedby={`${ids}-times`} className="min-w-0 space-y-4 border-t border-border pt-4">
      <fieldset disabled={unavailable || save.isPending} className="min-w-0 space-y-4">
        <label className="block space-y-1 text-sm font-medium">{t.publication}<select className={field} required value={publicationId} onChange={(e) => { setPublication(e.target.value); setExperiment('baseline'); }}><option value="">—</option>{publications.map((post) => <option key={post.id} value={post.id}>{t.versions[post.channel]} · {post.title}</option>)}</select></label>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block min-w-0 space-y-1 text-sm font-medium">{t.publishedAt}<input type="datetime-local" required value={publishedAt} onChange={(e) => setPublished(e.target.value)} className={field} /></label>
          <label className="block min-w-0 space-y-1 text-sm font-medium">{t.observedAt}<input type="datetime-local" required value={observedAt} onChange={(e) => setObserved(e.target.value)} className={field} /></label>
        </div>
        <p id={`${ids}-times`} className="text-xs text-foreground-muted">{t.timeHelp}</p>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="block space-y-1 text-sm font-medium">{t.experiment}<select className={field} value={experiment} onChange={(e) => setExperiment(e.target.value as typeof experiment)}><option value="baseline">{t.baseline}</option>{experiments.filter((exp) => exp.channel === posts.get(publicationId)?.channel).map((exp) => <option key={exp.id} value={exp.id}>{exp.title[lang]}</option>)}</select></label>
          <label className="block space-y-1 text-sm font-medium">{t.variant}<select className={field} value={variant} onChange={(e) => setVariant(e.target.value as 'A' | 'B')}><option value="A">{t.variantA}</option><option value="B">{t.variantB}</option></select></label>
        </div>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">{STRATEGY_METRICS.map((key) => <label key={key} className="block min-w-0 space-y-1 text-sm font-medium">{t.metrics[key]}<input type="number" min={0} max={2_000_000_000} step={1} inputMode="numeric" value={metrics[key]} onChange={(e) => setMetrics((m) => ({ ...m, [key]: e.target.value }))} className={field} /></label>)}</div>
        <label className="block space-y-1 text-sm font-medium">{t.evidenceLabel}<input required minLength={3} maxLength={500} value={evidence} onChange={(e) => setEvidence(e.target.value)} aria-describedby={`${ids}-evidence-help`} className={field} /></label>
        <p id={`${ids}-evidence-help`} className="text-xs text-foreground-muted">{t.evidenceHelp}</p>
        <Button type="submit" aria-busy={save.isPending}>{save.isPending ? t.saving : t.save}</Button>
      </fieldset>
    </form>}
    {notice && <p role={invalid || save.isError ? 'alert' : 'status'} className="text-sm">{notice}</p>}
    {(read?.results.length ?? 0) > 0 && <section className="min-w-0 border-t border-border pt-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">{t.snapshot}</h3><Button size="sm" variant="outline" onClick={exportResults}>{t.export}</Button></div>
      <ul className="mt-3 divide-y divide-border">{read!.results.map((row) => {
        const post = posts.get(row.publication_id);
        const denominator = post?.channel === 'threads' ? row.metrics.views : row.metrics.reach;
        const action = post?.channel === 'instagram' ? row.metrics.shares : row.metrics.replies;
        const age = strategyAgeWindow(row.published_at, row.observed_at);
        return <li key={row.id} className="py-3 text-sm"><p className="font-medium">{post ? `${t.versions[post.channel]} · ${post.title}` : row.publication_id}</p>
          <p className="mt-1 break-words text-xs text-foreground-muted"><time dateTime={row.observed_at}>{new Date(row.observed_at).toLocaleString(lang === 'cs' ? 'cs-CZ' : 'en-GB')}</time> · {age === 'other' ? t.other : age} · {row.experiment === 'baseline' ? t.baseline : experiments.find((e) => e.id === row.experiment)?.title[lang]} · {row.variant}</p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">{STRATEGY_METRICS.filter((key) => row.metrics[key] !== null).map((key) => <div key={key}><dt className="text-foreground-muted">{t.metrics[key]}</dt><dd className="tabular-nums">{number(row.metrics[key])}</dd></div>)}<div><dt className="text-foreground-muted">{post?.channel === 'instagram' ? t.metrics.shares : t.metrics.replies} / 1 000</dt><dd>{post ? number(strategyRate(action, denominator)) : t.unknown}</dd></div></dl>
          <p className="mt-2 break-words text-xs">{row.evidence}</p>
          {post?.remoteUrl && <a href={post.remoteUrl} target="_blank" rel="noreferrer" className="focus-ring mt-2 inline-flex min-h-11 items-center text-xs underline">{t.publication}</a>}
        </li>;
      })}</ul>
    </section>}
    <section className="min-w-0 space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">{t.comparison}</h3><p className="text-sm leading-relaxed text-foreground-muted">{growthResearch.common.decision[lang]}</p>
      <div className="grid min-w-0 gap-3 sm:grid-cols-2"><label className="block space-y-1 text-sm">{t.experiment}<select className={field} value={comparisonExperiment} onChange={(e) => setComparisonExperiment(e.target.value)}>{experiments.map((exp) => <option key={exp.id} value={exp.id}>{exp.title[lang]}</option>)}</select></label><label className="block space-y-1 text-sm">{t.age}<select className={field} value={window} onChange={(e) => setWindow(e.target.value as typeof window)}>{['72h', '7d', '24h'].map((w) => <option key={w}>{w}</option>)}</select></label></div>
      {comparisons.length === 0 ? <p className="text-sm text-foreground-muted">{t.noComparison}</p> : <ul className="divide-y divide-border">{comparisons.map((row) => <li key={`${row.channel}:${row.format}:${row.variant}`} className="py-3 text-sm">
        <p className="font-medium">{t.versions[row.channel]} · {t.formatLabels[row.format as keyof typeof t.formatLabels] ?? t.publication} · {row.variant}</p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs"><div><dt>{t.per1000}</dt><dd className="tabular-nums">{number(row.median)}</dd></div><div><dt>{t.sample}</dt><dd>{row.sample}</dd></div><div><dt>{t.denominator}</dt><dd>{number(row.denominator)}</dd></div></dl>
        <div aria-hidden className="mt-2 h-2 bg-surface-inset"><div className="h-full bg-primary" style={{ width: `${row.median / biggest * 100}%` }} /></div><p className="mt-2 text-xs text-foreground-muted">{row.sufficient ? t.descriptive : t.insufficient}</p>
      </li>)}</ul>}
    </section>
  </div>;
}
