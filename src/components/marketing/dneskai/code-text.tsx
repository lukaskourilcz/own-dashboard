'use client';

import { describeMarketingCode } from '@/lib/marketing/marketing-codes';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { cn } from '@/lib/utils';

/**
 * What a recorded code means for the owner: what happened and what happens next, in plain words. The code itself
 * stays inside a collapsed Details element, with any other technical fields the caller passes.
 */
export function DneskaiCodeText({ code, lang, className, details, tone = 'risk' }: {
  code: string | null; lang: 'en' | 'cs'; className?: string; details?: Array<[string, string | null | undefined]>; tone?: 'risk' | 'muted';
}) {
  const t = dneskaiWorkspace[lang];
  const text = describeMarketingCode(code, lang);
  const rows = [...(details ?? []), ...(text.code ? [[t.detailCode, text.code] as [string, string]] : [])].filter((row): row is [string, string] => !!row[1]);
  return <div className={cn('min-w-0 space-y-1 text-xs', className)}>
    <p className={tone === 'risk' ? 'text-risk' : 'text-foreground'}><span className="sr-only">{t.card.whatHappened}: </span>{text.happened}</p>
    <p className="text-foreground-muted"><span className="font-medium">{t.card.whatNext}:</span> {text.next}</p>
    {rows.length > 0 && <DneskaiDetails lang={lang} rows={rows} />}
  </div>;
}

/** Technical identifiers, collapsed by default and wrap-safe. */
export function DneskaiDetails({ rows, lang, className }: { rows: Array<[string, string | null | undefined]>; lang: 'en' | 'cs'; className?: string }) {
  const t = dneskaiWorkspace[lang];
  const visible = rows.filter((row): row is [string, string] => !!row[1]);
  if (!visible.length) return null;
  return <details className={cn('text-xs text-foreground-muted', className)}>
    <summary className="inline-flex min-h-11 cursor-pointer items-center rounded focus-ring md:min-h-6">{t.details}</summary>
    <dl className="mt-1 space-y-1">{visible.map(([label, value]) => <div key={label} className="min-w-0"><dt className="inline">{label}: </dt><dd className="inline break-all font-mono">{value}</dd></div>)}</dl>
  </details>;
}
