'use client';
import { useId } from 'react';
import { Button } from '@/components/ui/button';
import type { MarketingJobHealth } from '@/lib/marketing/job-health';

const copy = {
  en: { title: 'Draft preparation', scope: 'Latest 10 jobs. Check status manually; a status check does not start generation.',
    empty: 'No jobs for this brand in the loaded sample.', refresh: 'Check status again', checking: 'Checking status…', unknownBrand: 'Brand not recorded',
    queued: 'Waiting', running: 'Generating', review: 'Ready for review', failed: 'Problem', reconciliation: 'Verify the result', unavailable: 'Status unavailable',
    failure: 'No finished draft was saved. Review the problem before the owner requests another generation.', provider: 'The provider did not finish generation.',
    source: 'The source changed or is unavailable.', configuration: 'Check the provider setup and owner consent.', budget: 'Check the approved generation budget.',
    template: 'Check the approved template.', validation: 'The output did not pass validation.', uncertain: 'The result is uncertain. Verify it before requesting another generation.',
    job: 'Job', code: 'Recorded error', runningNote: 'A finished draft will appear here after it passes validation.',
  },
  cs: { title: 'Příprava návrhů', scope: 'Posledních 10 úloh. Stav ověřte ručně; kontrola stavu nespouští generování.',
    empty: 'V načteném vzorku nejsou pro tuto značku žádné úlohy.', refresh: 'Zkontrolovat stav znovu', checking: 'Kontroluje se stav…', unknownBrand: 'Značka není zaznamenaná',
    queued: 'Čeká', running: 'Generuje se', review: 'Ke kontrole', failed: 'Problém', reconciliation: 'Ověřit výsledek', unavailable: 'Stav není dostupný',
    failure: 'Hotový návrh se neuložil. Než vlastník zadá nové generování, zkontrolujte problém.', provider: 'Poskytovatel generování nedokončil.',
    source: 'Podklad se změnil nebo není dostupný.', configuration: 'Zkontrolujte nastavení poskytovatele a souhlas vlastníka.', budget: 'Zkontrolujte schválený rozpočet generování.',
    template: 'Zkontrolujte schválenou šablonu.', validation: 'Výstup neprošel kontrolou.', uncertain: 'Výsledek není jistý. Ověřte ho před zadáním dalšího generování.',
    job: 'Úloha', code: 'Zaznamenaná chyba', runningNote: 'Hotový návrh se zde objeví, až projde kontrolou.',
  },
} as const;

export function MarketingJobHealthSummary({ jobs, lang, disabled, refreshing, onRefresh }: {
  jobs: MarketingJobHealth[]; lang: 'en' | 'cs'; disabled: boolean; refreshing: boolean; onRefresh: () => void;
}) {
  const id = useId(); const t = copy[lang];
  const reason = (code: string | null) => !code ? t.failure : code.startsWith('provider-') ? t.provider : code.startsWith('source-') || code.startsWith('calendar-') ? t.source
    : code.startsWith('template-') ? t.template : code === 'budget-exceeded' ? t.budget : code === 'configuration-required' || code === 'consent-required' ? t.configuration
      : code.startsWith('worker-') ? t.uncertain : code === 'copy-validation-failed' || code === 'asset-validation-failed' ? t.validation : t.failure;
  return <section aria-labelledby={`${id}-title`} className="mb-5 min-w-0 rounded-lg border border-border bg-surface p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h2 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h2><p className="mt-1 text-xs text-foreground-muted">{t.scope}</p></div>
      <Button type="button" variant="outline" className="h-11 max-w-full md:h-8" disabled={disabled || refreshing} onClick={onRefresh}>{refreshing ? t.checking : t.refresh}</Button></div>
    <div aria-live="polite" aria-busy={refreshing}>{jobs.length ? <ul className="mt-3 divide-y divide-border">{jobs.slice(0, 10).map(job => <li key={job.id} className="min-w-0 py-3 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2"><p className="font-medium">{job.brand === 'devshark' ? 'devShark' : job.brand === 'dneskai' ? 'DNESKAi' : t.unknownBrand} · {t[job.status]}</p>
        <time dateTime={job.createdAt} className="text-foreground-muted">{new Intl.DateTimeFormat(lang === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Prague' }).format(new Date(job.createdAt))}</time></div>
      {(job.status === 'failed' || job.status === 'reconciliation' || job.status === 'unavailable') && <p className="mt-2 break-words">{job.status === 'reconciliation' ? t.uncertain : reason(job.errorCode)}</p>}
      {job.status === 'failed' && job.errorCode && reason(job.errorCode) !== t.failure && <p className="mt-1 text-foreground-muted">{t.failure}</p>}
      {(job.status === 'queued' || job.status === 'running') && <p className="mt-1 text-foreground-muted">{t.runningNote}</p>}
      <details className="mt-2 text-foreground-muted"><summary className="cursor-pointer">{t.job}</summary><p className="mt-1 break-all font-mono">{job.id}</p>{job.errorCode && <p className="mt-1 break-all">{t.code}: <code>{job.errorCode}</code></p>}</details>
    </li>)}</ul> : <p className="mt-3 text-xs text-foreground-muted">{t.empty}</p>}</div>
  </section>;
}
