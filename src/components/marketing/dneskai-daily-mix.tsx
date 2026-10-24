'use client';

import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { qk } from '@/lib/queries/keys';
import { dneskaiDailyMix } from '@/lib/i18n/sections/dneskai-daily-mix';
import { DNESKAI_DAILY_MIX_TIMES, dneskaiActiveSlotTimes, type DneskaiDailyMix, type DneskaiDailyMixTime } from '@/lib/marketing/dneskai-daily-mix';
import { loadDneskaiDailyMix, saveDneskaiDailyMix } from '@/lib/marketing/dneskai-daily-mix-client';

type Lang = 'en' | 'cs';
const COUNTS = [0, 1, 2, 3, 4] as const;

/**
 * Zdroje → Denní mix (#156): news and education posts a day and the active times. Renders nothing while the server
 * has the mix off; in the preview it shows the default and saves nothing.
 */
export function DneskaiDailyMixPanel({ projectId, lang, preview = false, showDisabled = false }: { projectId: string; lang: Lang; preview?: boolean; showDisabled?: boolean }) {
  const t = dneskaiDailyMix[lang];
  const key = [...qk.dneskaiDailyMix, projectId, preview];
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, retry: false, staleTime: 30_000, refetchOnWindowFocus: false, queryFn: ({ signal }) => loadDneskaiDailyMix(projectId, preview, signal) });
  const [draft, setDraft] = useState<DneskaiDailyMix | null>(null);
  const [notice, setNotice] = useState('');
  useEffect(() => { if (query.data) setDraft(query.data.mix); }, [query.data]);
  const save = useMutation({
    mutationFn: (mix: DneskaiDailyMix) => saveDneskaiDailyMix(projectId, mix),
    onMutate: () => setNotice(''),
    onSuccess: (read) => { client.setQueryData(key, read); setNotice(t.saved); },
    onError: () => setNotice(t.failed),
  });
  const titleId = useId(), newsId = useId(), educationId = useId(), problemId = useId();
  const posts = draft ? draft.newsPerDay + draft.educationPerDay : 0;
  const tooFew = !!draft && posts > draft.slots.length;
  useUnsavedDraft({ pending: save.isPending, dirty: !preview && !!draft && !!query.data && JSON.stringify(draft) !== JSON.stringify(query.data.mix), canSave: !save.isPending && !tooFew,
    save: async () => { if (!draft || tooFew || preview) return false; try { await save.mutateAsync(draft); return true; } catch { return false; } } });
  if (query.data === null) return showDisabled ? <p role="status" className="text-sm text-foreground-muted">{t.disabled}</p> : null;
  if (query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (query.isError) return <div role="alert"><p className="text-sm text-risk">{t.unavailable}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t.retry}</Button></div>;
  if (!draft || !query.data) return null;
  const toggle = (time: DneskaiDailyMixTime, on: boolean) => setDraft({ ...draft, slots: on ? dneskaiActiveSlotTimes({ slots: [...draft.slots, time] }) : draft.slots.filter((item) => item !== time) });
  const select = (id: string, label: string, value: number, change: (value: number) => void) => <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-sm">
    <span className="font-medium">{label}</span>
    <select id={id} value={value} onChange={(event) => change(Number(event.target.value))} className="h-11 w-24 md:h-8 rounded-md border border-border-strong bg-surface px-2 text-sm tabular focus-ring" disabled={save.isPending}>
      {COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
    </select>
  </label>;
  return <section aria-labelledby={titleId} className="form-frame min-w-0 space-y-4" data-testid="dneskai-daily-mix">
    <div className="min-w-0"><h2 id={titleId} className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {preview && <p className="text-sm text-foreground-muted">{t.preview}</p>}
    {!query.data.stored && !preview && <p className="text-xs text-foreground-muted">{t.defaultNote}</p>}
    <form className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start" onSubmit={(event) => { event.preventDefault(); if (!tooFew && !preview) save.mutate(draft); }}>
      <div className="flex flex-wrap gap-3">
        {select(newsId, t.news, draft.newsPerDay, (value) => setDraft({ ...draft, newsPerDay: value }))}
        {select(educationId, t.education, draft.educationPerDay, (value) => setDraft({ ...draft, educationPerDay: value }))}
      </div>
      <fieldset className="space-y-2" aria-describedby={tooFew ? problemId : undefined}>
        <legend className="text-sm font-medium">{t.times}</legend>
        <div className="flex flex-wrap gap-x-3">
          {DNESKAI_DAILY_MIX_TIMES.map((time) => <label key={time} className="flex min-h-11 items-center gap-2 text-sm tabular md:min-h-8">
            <Checkbox checked={draft.slots.includes(time)} onCheckedChange={(value) => toggle(time, value === true)} disabled={save.isPending || (draft.slots.length === 1 && draft.slots.includes(time))} />
            {time}
          </label>)}
        </div>
        {tooFew && <p role="alert" id={problemId} className="text-xs text-risk">{t.tooFew(posts, draft.slots.length)}</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 lg:max-w-40 lg:pt-6">
        <Button type="submit" disabled={preview || tooFew || save.isPending}>{save.isPending ? t.saving : t.save}</Button>
        <p role="status" className="text-sm empty:hidden">{notice}</p>
      </div>
    </form>
  </section>;
}
