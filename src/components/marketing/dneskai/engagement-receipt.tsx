'use client';

import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { formatDneskaiDayTime, type DneskaiEngagementReceipt, type DneskaiWorkspaceRead } from '@/lib/marketing/dneskai-workspace';
import { DneskaiCodeText } from './code-text';

type Lang = 'en' | 'cs';

/** #162: one published post's keyword comments: what the watcher read, matched and sent, and what failed, by code. */
export function DneskaiEngagementReceipt({ receipt, lang }: { receipt: DneskaiEngagementReceipt; lang: Lang }) {
  const t = dneskaiWorkspace[lang].engagementReceipts;
  const failed = receipt.failures.reduce((sum, item) => sum + item.count, 0);
  return <section aria-label={t.label} className="space-y-1 text-xs" data-testid="dneskai-engagement-receipt">
    <p className="font-medium">{t.label}</p>
    <dl className="flex flex-wrap gap-x-4 gap-y-0.5 text-foreground-muted">
      {([[t.comments, receipt.commentsSeen], [t.matches, receipt.keywordMatches], [t.sent, receipt.privateSent], [t.publicSent, receipt.publicSent], [t.failed, failed]] as const).map(([label, value]) =>
        <div key={label}><dt className="inline">{label}: </dt><dd className="inline tabular">{value}</dd></div>)}
      <div><dt className="inline">{t.lastCheck}: </dt><dd className="inline tabular">{receipt.lastCheckedAt ? <time dateTime={receipt.lastCheckedAt}>{formatDneskaiDayTime(receipt.lastCheckedAt)}</time> : t.notChecked}</dd></div>
    </dl>
    {receipt.failures.length > 0 && <ul className="space-y-1">{receipt.failures.map((item) =>
      <li key={item.code} className="flex flex-wrap items-baseline gap-x-2"><span className="tabular text-foreground-muted">{t.failure(item.count)}:</span><DneskaiCodeText code={item.code} lang={lang} /></li>)}</ul>}
  </section>;
}

/** #162: the seven-day totals above the list. */
export function DneskaiEngagementSummary({ summary, lang }: { summary: NonNullable<DneskaiWorkspaceRead['engagementSummary']>; lang: Lang }) {
  const t = dneskaiWorkspace[lang].engagementReceipts;
  return <section aria-label={t.summary(7)} className="rounded-lg border border-border bg-surface p-3 text-xs" data-testid="dneskai-engagement-summary">
    <p className="font-medium">{t.summary(7)}</p>
    <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-foreground-muted">
      {([[t.comments, summary.commentsSeen], [t.matches, summary.keywordMatches], [t.sent, summary.privateSent], [t.publicSent, summary.publicSent], [t.failed, summary.failed]] as const).map(([label, value]) =>
        <div key={label}><dt className="inline">{label}: </dt><dd className="inline tabular">{value}</dd></div>)}
    </dl>
  </section>;
}
