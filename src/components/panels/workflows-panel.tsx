'use client';

import { ArrowDown, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { useDict } from '@/lib/i18n';
import { WORKFLOW_AREAS } from '@/lib/i18n/sections/workflows';
import { tabToPath, type NavTab } from '@/lib/nav-tabs';

function ProcessMap({ title, steps, note }: { title: string; steps: string[]; note: string }) {
  return <figure className="min-w-0 border-t border-border py-4 first:border-t-0">
    <figcaption className="mb-3 text-sm font-semibold text-foreground">{title}</figcaption>
    <ol className="flex min-w-0 flex-col gap-2 md:flex-row md:items-stretch" aria-label={title}>
      {steps.map((step, index) => <li key={step} className="flex min-w-0 flex-1 flex-col gap-2 md:flex-row md:items-center">
        {index > 0 && <><ArrowDown aria-hidden className="h-4 w-4 shrink-0 text-foreground-subtle md:hidden" /><ArrowRight aria-hidden className="hidden h-4 w-4 shrink-0 text-foreground-subtle md:block" /></>}
        <div className="flex min-h-12 min-w-0 flex-1 items-start gap-2 rounded-md border border-border bg-surface-inset px-3 py-2 text-xs leading-relaxed text-foreground">
          <span aria-hidden className="shrink-0 font-mono text-foreground-subtle">{index + 1}</span><span className="break-words">{step}</span>
        </div>
      </li>)}
    </ol>
    <p className="mt-3 text-xs leading-relaxed text-foreground-muted">{note}</p>
  </figure>;
}

export function WorkflowsPanel({ onNavigate }: { onNavigate: (tab: NavTab) => void }) {
  const dict = useDict(); const t = dict.workflows;
  const destination = (tab: NavTab) => <a key={tab} href={tabToPath(tab)} className="inline-flex min-h-11 items-center gap-1 rounded px-2 text-xs font-medium text-brand hover:bg-surface-hover focus-ring" onClick={event => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault(); onNavigate(tab);
  }}>{dict.nav.sections[tab]}<ArrowRight aria-hidden className="h-3.5 w-3.5" /></a>;
  return <div className="min-w-0 space-y-6" data-testid="workflows-panel">
    <PageHeader title={t.title} description={t.description} />
    <p className="text-xs text-foreground-muted">{t.verified}</p>
    <section aria-labelledby="workflows-map-title" className="min-w-0">
      <h2 id="workflows-map-title" className="text-base font-semibold">{t.map}</h2>
      {t.mapFlows.map(flow => <ProcessMap key={flow.title} {...flow} />)}
    </section>
    <section aria-labelledby="workflows-areas-title">
      <h2 id="workflows-areas-title" className="mb-3 text-base font-semibold">{t.areasTitle}</h2>
      <div className="divide-y divide-border border-y border-border">
        {Object.entries(WORKFLOW_AREAS).map(([key, tabs]) => {
          const id = key as keyof typeof WORKFLOW_AREAS; const area = t.areas[id];
          return <section key={key} aria-labelledby={`workflows-area-${key}`} className="grid min-w-0 gap-3 py-5 lg:grid-cols-[210px_minmax(0,1fr)]">
            <div className="min-w-0"><h3 id={`workflows-area-${key}`} className="text-sm font-semibold">{area.title}</h3><p className="mt-1 text-xs text-foreground-muted">{id === 'marketing' ? t.pilot : t.works}</p></div>
            <div className="min-w-0"><p className="mb-3 text-sm">{area.purpose}</p>
              <dl className="grid min-w-0 gap-3 text-xs sm:grid-cols-2">{(['input', 'owner', 'automatic', 'result'] as const).map(field => <div key={field} className="min-w-0"><dt className="mb-1 font-medium text-foreground">{t[field]}</dt><dd className="break-words leading-relaxed text-foreground-muted">{area[field]}</dd></div>)}</dl>
              <nav aria-label={area.title} className="mt-2 flex flex-wrap gap-x-2">{tabs.map(destination)}</nav>
            </div>
          </section>;
        })}
      </div>
    </section>
    <section aria-labelledby="workflows-marketing-title" className="min-w-0">
      <div className="flex flex-wrap items-baseline gap-3"><h2 id="workflows-marketing-title" className="text-base font-semibold">{t.marketingTitle}</h2><span className="text-xs text-foreground-muted">{t.pilot}</span></div>
      <p className="mt-2 text-sm text-foreground-muted">{t.marketingIntro}</p>
      {t.marketingFlows.map(flow => <ProcessMap key={flow.title} {...flow} />)}
      <div className="border-l-2 border-border-strong pl-3 text-sm leading-relaxed"><p>{t.marketingHold}</p><p className="mt-2 text-foreground-muted">{t.weekly}</p><p className="mt-2 text-xs text-foreground-muted">{t.setup}: Instagram Insights · Threads</p></div>
    </section>
    <section aria-labelledby="workflows-next-title" className="border-t border-border pt-4">
      <h2 id="workflows-next-title" className="text-sm font-semibold">{t.next}</h2><p className="mt-2 text-sm text-foreground-muted">{t.nextDescription}</p>
      <div className="mt-2 flex flex-wrap gap-2">{destination('marketing')}{destination('settings')}<a href="https://github.com/lukaskourilcz/own-dashboard/issues/102" className="inline-flex min-h-11 items-center rounded px-2 text-xs text-brand focus-ring">{t.details}</a></div>
    </section>
  </div>;
}
