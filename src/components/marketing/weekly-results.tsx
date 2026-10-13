'use client';
import { useId } from 'react';
import { z } from 'zod';
import type { MarketingBrand, MarketingRevisionRow, PublicationRow } from '@/lib/marketing/contracts';
import { compareMarketingWeeks } from '@/lib/marketing/weekly-analytics';
import { pragueMarketingDate, sevenDayMarketingWindow } from '@/lib/marketing/weekly-planning';

export type WeeklyResultsProps = {
  revisions: readonly MarketingRevisionRow[]; publications: readonly PublicationRow[];
  brand?: MarketingBrand | 'all'; lang: 'en' | 'cs'; weekStartsOn?: string; now?: Date;
};
const revisionMetadata = z.object({ id: z.uuid(), revision: z.object({ brand: z.enum(['devshark', 'dneskai']), scheduledAt: z.iso.datetime({ offset: true }), account: z.object({ platform: z.enum(['instagram', 'threads']) }) }) });
const publicationMetadata = z.object({ id: z.uuid(), revision_id: z.uuid(), platform: z.enum(['instagram', 'threads']), status: z.enum(['queued', 'claimed', 'published', 'failed', 'reconciliation', 'cancelled']), remote_media_id: z.string().max(200).nullable(), remote_url: z.string().max(2000).nullable() });
const copy = {
  en: { title: 'Weekly publication review', scope: 'Seven completed Prague calendar days by default. Counts refer to scheduled slots and their recorded outcomes, not the actual publication timestamp.',
    loaded: 'Only the latest loaded records are included (up to 100 revisions and 100 publications). This is a partial sample, not a complete weekly total.',
    empty: 'No matched publication records for these scheduled slots.', invalid: 'The reporting window is unavailable.', unmatched: 'Some loaded records have missing or mismatched evidence. They do not count as confirmed publications.',
    published: 'Confirmed published', waiting: 'Waiting or in progress', failed: 'Failed', reconciliation: 'Needs verification', cancelled: 'Cancelled',
    records: 'Recorded outcomes', metrics: 'Engagement metrics', unavailable: 'Not collected', reach: 'Reach', saved: 'Saves', shares: 'Shares', replies: 'Replies',
    metricHold: 'Instagram Insights and Threads analytics are not connected. No reach or engagement values have been collected. This page does not request access or collect metrics.',
    evaluation: 'Review the confirmed receipts and failures before the next plan. Compare engagement only after measured data exists for posts of the same age. Early small samples cannot establish a winning format.',
    missingReceipts: 'Drafts or approved revisions without a publication receipt do not count as published.',
  },
  cs: { title: 'Týdenní přehled publikování', scope: 'Výchozí okno zahrnuje sedm dokončených kalendářních dnů v Praze. Počty patří k plánovaným termínům a zaznamenaným výsledkům, nikoli ke skutečnému času zveřejnění.',
    loaded: 'Zahrnujeme jen poslední načtené záznamy (nejvýše 100 verzí a 100 zveřejnění). Jde o dílčí vzorek, ne úplný týdenní součet.',
    empty: 'Pro tyto plánované termíny nejsou přiřazené záznamy zveřejnění.', invalid: 'Okno vyhodnocení není dostupné.', unmatched: 'U některých načtených záznamů chybí důkazy nebo nesouhlasí přiřazení. Nepočítáme je jako potvrzená zveřejnění.',
    published: 'Potvrzené zveřejnění', waiting: 'Čeká nebo probíhá', failed: 'Selhalo', reconciliation: 'Vyžaduje ověření', cancelled: 'Zrušeno',
    records: 'Zaznamenané výsledky', metrics: 'Reakce publika', unavailable: 'Není změřeno', reach: 'Dosah', saved: 'Uložení', shares: 'Sdílení', replies: 'Odpovědi',
    metricHold: 'Instagram Insights a analytika Threads zatím nejsou připojené. Dosah ani reakce jsme nezměřili. Tato stránka nežádá o přístup ani nesbírá metriky.',
    evaluation: 'Před dalším plánem zkontrolujte potvrzená zveřejnění a chyby. Reakce porovnávejte až podle naměřených dat stejně starých příspěvků. První malé vzorky neurčují vítězný formát.',
    missingReceipts: 'Návrhy ani schválené verze bez potvrzení zveřejnění nepočítáme jako publikované.',
  },
};
type Counters = { published: number; waiting: number; failed: number; reconciliation: number; cancelled: number };
function validRemote(value: z.infer<typeof publicationMetadata>): boolean {
  if (!value.remote_media_id || !/^\S+$/u.test(value.remote_media_id) || !value.remote_url) return false;
  try { const url = new URL(value.remote_url); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}

/** Scalar projections only. No fetched/provider measurements and no publication-time inference. */
export function weeklyRecordedResults(input: WeeklyResultsProps) {
  const today = pragueMarketingDate(input.now ?? new Date());
  const start = input.weekStartsOn ?? new Date(Date.parse(`${today}T12:00:00Z`) - 7 * 86400000).toISOString().slice(0, 10);
  const window = sevenDayMarketingWindow(start);
  const revisions = new Map<string, z.infer<typeof revisionMetadata>>(); const duplicateRevisions = new Set<string>();
  let excluded = 0;
  for (const raw of input.revisions.slice(0, 100)) {
    const item = revisionMetadata.safeParse(raw);
    if (!item.success) { excluded++; continue; }
    if (revisions.has(item.data.id)) duplicateRevisions.add(item.data.id);
    else revisions.set(item.data.id, item.data);
  }
  const outcomes = new Map<string, z.infer<typeof publicationMetadata>>(); const duplicates = new Set<string>();
  for (const raw of input.publications.slice(0, 100)) {
    const item = publicationMetadata.safeParse(raw);
    if (!item.success) { excluded++; continue; }
    if (outcomes.has(item.data.id)) duplicates.add(item.data.id);
    else outcomes.set(item.data.id, item.data);
  }
  const rows = (['devshark', 'dneskai'] as const).filter(brand => !input.brand || input.brand === 'all' || brand === input.brand).flatMap(brand => (['instagram', 'threads'] as const).map(platform => {
    const counts: Counters = { published: 0, waiting: 0, failed: 0, reconciliation: 0, cancelled: 0 };
    return { brand, platform, counts };
  }));
  for (const publication of outcomes.values()) {
    const matched = revisions.get(publication.revision_id);
    if (!matched || duplicateRevisions.has(publication.revision_id) || duplicates.has(publication.id) || publication.platform !== matched.revision.account.platform) { excluded++; continue; }
    const scheduled = Date.parse(matched.revision.scheduledAt);
    if (scheduled < Date.parse(window.startAt) || scheduled >= Date.parse(window.endAtExclusive)) continue;
    const row = rows.find(row => row.brand === matched.revision.brand && row.platform === publication.platform);
    if (!row) continue;
    if (publication.status === 'published') {
      if (validRemote(publication)) row.counts.published++;
      else { row.counts.reconciliation++; excluded++; }
    } else if (publication.status === 'queued' || publication.status === 'claimed') row.counts.waiting++;
    else row.counts[publication.status]++;
  }
  return { window, excluded, rows: rows.map(row => ({ ...row, analysis: compareMarketingWeeks({ brand: row.brand, platform: row.platform, weekStartsOn: start,
    definitionsId: 'loaded-scheduled-publication-outcomes/1', origin: 'own-persisted', measuredAt: null,
    observations: { publishedPosts: { value: row.counts.published, coverage: 'partial', sampleSize: Object.values(row.counts).reduce((sum, count) => sum + count, 0) },
      reach: { value: null, coverage: 'unavailable', sampleSize: null }, saved: { value: null, coverage: 'unavailable', sampleSize: null },
      shares: { value: null, coverage: 'unavailable', sampleSize: null }, replies: { value: null, coverage: 'unavailable', sampleSize: null } },
  }) })) };
}

export function WeeklyResults(props: WeeklyResultsProps) {
  const id = useId(); const t = copy[props.lang]; let result: ReturnType<typeof weeklyRecordedResults> | null = null;
  try { result = weeklyRecordedResults(props); } catch { /* Keep invalid/missing metadata away from the owner surface. */ }
  const date = (value: string) => new Intl.DateTimeFormat(props.lang === 'cs' ? 'cs-CZ' : 'en-GB', { dateStyle: 'medium', timeZone: 'Europe/Prague' }).format(new Date(`${value}T12:00:00Z`));
  return <section aria-labelledby={`${id}-title`} className="mb-5 min-w-0 border-y border-border py-4" data-testid="weekly-results">
    <h2 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h2>
    {result ? <>
      <p className="mt-2 text-sm"><time dateTime={result.window.startDate}>{date(result.window.startDate)}</time> → <time dateTime={result.window.endDateInclusive}>{date(result.window.endDateInclusive)}</time> · Europe/Prague</p>
      <p className="mt-2 text-xs leading-relaxed text-foreground-muted">{t.scope}</p>
      <p className="mt-1 text-xs leading-relaxed text-foreground-muted">{t.loaded}</p>
      {result.excluded > 0 && <p className="mt-2 text-xs">{t.unmatched}</p>}
      {!result.rows.some(row => Object.values(row.counts).some(Boolean)) && <p className="mt-3 text-sm">{t.empty}</p>}
      <ul className="mt-3 divide-y divide-border" aria-label={t.records}>{result.rows.map(row => <li key={`${row.brand}-${row.platform}`} className="min-w-0 py-3 text-xs">
        <h3 className="font-medium">{row.brand === 'devshark' ? 'devShark' : 'DNESKAi'} · {row.platform === 'instagram' ? 'Instagram' : 'Threads'}</h3>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-5">{(Object.keys(row.counts) as Array<keyof Counters>).map(key => <div key={key} className="min-w-0"><dt className="text-foreground-muted">{t[key]}</dt><dd className="mt-1 font-medium tabular-nums">{key === 'published' ? row.analysis.rows.find(item => item.metric === 'publishedPosts')?.currentObservedValue : row.counts[key]}</dd></div>)}</dl>
      </li>)}</ul>
      <p className="mt-2 text-xs text-foreground-muted">{t.missingReceipts}</p>
      <h3 className="mt-4 text-xs font-semibold">{t.metrics}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">{(['reach', 'saved', 'shares', 'replies'] as const).map(metric => <div key={metric}><dt className="text-foreground-muted">{t[metric]}</dt><dd className="mt-1">{t.unavailable}</dd></div>)}</dl>
      <p className="mt-3 text-xs leading-relaxed text-foreground-muted">{t.metricHold}</p><p className="mt-2 text-xs leading-relaxed text-foreground-muted">{t.evaluation}</p>
    </> : <p role="alert" className="mt-2 text-sm">{t.invalid}</p>}
  </section>;
}
