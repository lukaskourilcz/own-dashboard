'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { marketingStrategy } from '@/lib/i18n/sections/marketing-strategy';
import plan from '@/lib/marketing/strategy/apify.json';
import type { PublishingBrand } from '@/lib/publishing-calendar';
import type { StrategyLang } from '@/lib/marketing/strategy/content';

/** Read-only, dated evidence. Paid execution stays in the existing guarded research workflow. */
export function StrategyApify({ brand, lang }: { brand: PublishingBrand; lang: StrategyLang }) {
  const t = marketingStrategy[lang].apify;
  const [notice, setNotice] = useState('');
  const [showBrief, setShowBrief] = useState(false);
  const money = (value: number) => new Intl.NumberFormat(lang === 'cs' ? 'cs-CZ' : 'en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 3 }).format(value);
  const brief = `${plan.brandBriefs[brand][lang]}\n\n${plan.workflow[lang]}\n\n${plan.guard[lang]}`;
  return <div className="min-w-0 space-y-6 text-sm leading-relaxed" data-testid="strategy-apify">
    <section className="space-y-3" aria-label={t.credits}>
      <h3 className="font-semibold">{t.credits}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div><dt className="text-foreground-muted">{t.remaining}</dt><dd className="font-semibold tabular-nums">{money(plan.remainingPrepaidUsd)}</dd></div>
        <div><dt className="text-foreground-muted">{t.proposed}</dt><dd className="font-semibold tabular-nums">{money(plan.proposedCeilingUsd)}</dd></div>
      </dl>
      <p>{plan.creditNote[lang]}</p><p className="text-foreground-muted">{t.limit}</p>
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label={t.brandBrief}>
      <h3 className="font-semibold">{t.brandBrief}</h3><p>{plan.brandBriefs[brand][lang]}</p>
      <Button variant="outline" size="sm" onClick={async () => { try { await navigator.clipboard.writeText(brief); setNotice(t.copied); } catch { setShowBrief(true); setNotice(t.copyFailed); } }}><Copy aria-hidden className="size-3.5" />{t.copy}</Button>
      {notice && <p role="status" className="text-foreground-muted">{notice}</p>}
      {showBrief && <pre className="whitespace-pre-wrap break-words text-xs">{brief}</pre>}
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label={t.sample}>
      <h3 className="font-semibold">{t.sample}</h3><p>{plan.finding[lang]}</p><p className="text-foreground-muted">{plan.sampleWindow[lang]}</p>
      <ul aria-label={t.sample} className="space-y-3">{plan.quality.map((row) => <li key={row.label.en}>
        <div className="flex justify-between gap-3"><span>{row.label[lang]}</span><span className="tabular-nums">{row.value} / 241</span></div>
        <div aria-hidden className="mt-1 h-1.5 rounded-sm bg-surface-inset"><div className="h-full rounded-sm bg-primary" style={{ width: `${row.value / 241 * 100}%` }} /></div>
      </li>)}</ul>
      <details><summary className="focus-ring min-h-11 cursor-pointer py-2 font-medium">{t.cohort}</summary>
        <p className="mb-3 text-foreground-muted">{t.cohortHelp}</p>
        <div className="overflow-x-auto"><table className="w-full text-left text-xs"><caption className="sr-only">{t.cohort}</caption>
          <thead><tr>{[t.handle, t.posts, t.recent, t.latest].map((label) => <th key={label} scope="col" className="border-b border-border p-2 font-medium">{label}</th>)}</tr></thead>
          <tbody>{plan.cohort.map((row) => <tr key={row.handle}><th scope="row" className="break-all border-b border-border p-2 font-medium">@{row.handle}</th><td className="border-b border-border p-2 tabular-nums">{row.posts}</td><td className="border-b border-border p-2 tabular-nums">{row.recent45d}</td><td className="whitespace-nowrap border-b border-border p-2 tabular-nums">{row.latest}</td></tr>)}</tbody>
        </table></div>
      </details>
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label={t.phases}>
      <h3 className="font-semibold">{t.phases}</h3>
      <ol className="divide-y divide-border">{plan.phases.map((phase, i) => <li key={phase.title.en} className="py-3"><h4 className="font-medium">{i + 1}. {phase.title[lang]} · {money(phase.capUsd)}</h4><p className="mt-1 text-foreground-muted">{phase.scope[lang]}</p></li>)}</ol>
      <p>{plan.guard[lang]}</p>
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label={t.actors}>
      <h3 className="font-semibold">{t.actors}</h3><p className="text-foreground-muted">{plan.pricing[lang]}</p>
      <ul className="divide-y divide-border">{plan.actors.map((actor) => <li key={actor.name} className="min-w-0 py-3"><a href={actor.url} target="_blank" rel="noreferrer" className="focus-ring break-all font-medium underline underline-offset-4">{actor.name}</a><p className="mt-1 tabular-nums">{t.startingPrice}: {money(actor.pricePer1000)}</p><p className="mt-1 text-foreground-muted">{actor.use[lang]}</p></li>)}</ul>
      <p>{plan.maintenance[lang]}</p>
      <details><summary className="focus-ring min-h-11 cursor-pointer py-2 font-medium">{t.runs}</summary><ul className="divide-y divide-border">{plan.runs.map((run) => <li key={run.url} className="py-3"><a href={run.url} target="_blank" rel="noreferrer" className="focus-ring underline underline-offset-4">{run.label[lang]}</a><p className="mt-1 tabular-nums">{t.rows}: {run.results} · {t.cost}: {money(run.costUsd)}</p></li>)}</ul></details>
    </section>
    <section className="space-y-3 border-t border-border pt-4" aria-label={t.workflow}><h3 className="font-semibold">{t.workflow}</h3><p>{plan.workflow[lang]}</p></section>
  </div>;
}
