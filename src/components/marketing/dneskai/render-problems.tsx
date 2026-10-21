'use client';

import { describeMarketingCode } from '@/lib/marketing/marketing-codes';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import type { DneskaiRenderReport } from '@/lib/marketing/contracts';
import { cn } from '@/lib/utils';

type Problem = DneskaiRenderReport['problems'][number];
type Lang = 'en' | 'cs';

/** The field or picture a problem names, in the owner's words (`sources[1]` → „Řádky zdrojů 2“, `image-2` → „Obrázek 2“). */
export function dneskaiFieldLabel(field: string | null | undefined, lang: Lang): string | null {
  if (!field) return null;
  const t = dneskaiWorkspace[lang];
  const source = /^sources\[(\d)\]$/.exec(field);
  if (source) return `${t.fields.sources} ${Number(source[1]) + 1}`;
  if (/^image-\d$/.test(field)) return t.editor.place(field);
  return (t.fields as Record<string, string>)[field] ?? null;
}

/** Render problems by slide and field, blocking ones first, each in plain words with its code in Details. */
export function DneskaiRenderProblems({ problems, lang, className, id }: { problems: readonly Problem[]; lang: Lang; className?: string; id?: string }) {
  const t = dneskaiWorkspace[lang];
  if (!problems.length) return null;
  const ordered = [...problems].sort((a, b) => Number(b.blocking) - Number(a.blocking) || a.slide - b.slide);
  return <section id={id} aria-label={t.card.renderProblems} className={cn('min-w-0 space-y-2', className)}>
    <h4 className="text-xs font-semibold">{t.card.renderProblems}</h4>
    <ul className="space-y-2">{ordered.slice(0, 20).map((problem, index) => {
      const text = describeMarketingCode(problem.code, lang);
      const where = [problem.slide >= 0 ? t.card.problemSlide(problem.slide + 1) : t.card.deckLevel, dneskaiFieldLabel(problem.field, lang)].filter(Boolean).join(' · ');
      return <li key={`${problem.slide}-${problem.code}-${problem.field ?? ''}-${index}`} className={cn('min-w-0 border-l-2 pl-2 text-xs', problem.blocking ? 'border-risk' : 'border-warning')}>
        <p><span className="font-semibold">{where}</span> · <span className={problem.blocking ? 'text-risk' : 'text-warning'}>{problem.blocking ? t.card.blocking : t.card.advisory}</span></p>
        <p className="mt-0.5 break-words">{text.happened}</p>
        <p className="text-foreground-muted">{text.next}</p>
        <details className="text-foreground-muted"><summary className="inline-flex min-h-11 cursor-pointer items-center rounded focus-ring md:min-h-6">{t.details}</summary><p className="break-all font-mono">{problem.code}</p></details>
      </li>;
    })}</ul>
  </section>;
}
