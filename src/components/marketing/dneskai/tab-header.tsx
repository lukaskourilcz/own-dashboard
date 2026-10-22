'use client';

import { Button } from '@/components/ui/button';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';

type Lang = 'en' | 'cs';

/** The heading, intro, refresh button and preview note of a DNESKAi workspace tab (#119). */
export function TabHeader({ id, title, intro, lang, refreshing, onRefresh, preview, unreadable = 0, focusable = false }: {
  id: string; title: string; intro: string; lang: Lang; refreshing: boolean; onRefresh: () => void; preview: boolean; unreadable?: number; focusable?: boolean;
}) {
  const t = dneskaiWorkspace[lang];
  return <div className="space-y-2">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h2 id={id} tabIndex={focusable ? -1 : undefined} className="rounded text-sm font-semibold focus-ring">{title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{intro}</p></div>
      <Button variant="outline" className="min-h-11 md:min-h-8" disabled={refreshing} aria-busy={refreshing} onClick={onRefresh}>{refreshing ? t.refreshing : t.refresh}</Button>
    </div>
    {preview && <p className="border-l-2 border-information pl-3 text-xs text-foreground-muted">{t.preview}</p>}
    {unreadable > 0 && <p className="text-xs text-warning">{t.unreadable(unreadable)}</p>}
  </div>;
}
