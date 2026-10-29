'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { qk } from '@/lib/queries/keys';
import { dneskaiDailyMix } from '@/lib/i18n/sections/dneskai-daily-mix';
import { DNESKAI_DAILY_MIX_TIMES, DneskaiDailyMixSchema, dneskaiActiveSlotTimes, sameDneskaiDailyMix, type DneskaiDailyMix, type DneskaiDailyMixTime, type DneskaiDailyMixRead } from '@/lib/marketing/dneskai-daily-mix';
import { DneskaiDailyMixRequestError, loadDneskaiDailyMix, saveDneskaiDailyMix } from '@/lib/marketing/dneskai-daily-mix-client';
import { databaseVersion } from '@/lib/database-version';

type Lang = 'en' | 'cs';
const COUNTS = [0, 1, 2, 3, 4] as const;

/**
 * Zdroje → Denní mix (#156): news and education posts a day and the active times. Renders nothing while the server
 * has the mix off; in the preview it shows the default and saves nothing.
 */
export function DneskaiDailyMixPanel({ projectId, lang, preview = false, showDisabled = false }: { projectId: string; lang: Lang; preview?: boolean; showDisabled?: boolean }) {
  return <DailyMix key={`${projectId}:${preview}`} projectId={projectId} lang={lang} preview={preview} showDisabled={showDisabled} />;
}
function DailyMix({ projectId, lang, preview, showDisabled }: { projectId: string; lang: Lang; preview: boolean; showDisabled: boolean }) {
  const t = dneskaiDailyMix[lang];
  const key = [...qk.dneskaiDailyMix, projectId, preview];
  const client = useQueryClient();
  const query = useQuery({ queryKey: key, retry: false, staleTime: 30_000, refetchOnWindowFocus: false, queryFn: ({ signal }) => loadDneskaiDailyMix(projectId, preview, signal) });
  const [draft, setDraft] = useState<DneskaiDailyMix | null>(null);
  const [source, setSource] = useState<DneskaiDailyMixRead | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<'saved' | 'failed' | 'changed' | null>(null);
  const operation = useRef<AbortController | null>(null), immediateDraft = useRef<DneskaiDailyMix | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  // Capture once. A refresh never replaces an open draft, including when a
  // background read fails or the feature is subsequently switched off.
  if (!source && query.data) { setSource(query.data); setDraft(query.data.mix); }
  const available = !!query.data && !query.isError;
  const changed = !!source && !!query.data && ((source.version === null ? null : databaseVersion(source.version)) !== (query.data.version === null ? null : databaseVersion(query.data.version)) || !sameDneskaiDailyMix(source.mix, query.data.mix));
  const updateDraft = (mix: DneskaiDailyMix) => { immediateDraft.current = mix; setDraft(mix); setNotice(null); };
  async function save(): Promise<boolean> {
    const mix = immediateDraft.current ?? draft;
    if (preview || operation.current || !source || !mix || !available || changed || !DneskaiDailyMixSchema.safeParse(mix).success) return false;
    const controller = new AbortController(); operation.current = controller; setPending(true); setNotice(null);
    try {
      const read = await saveDneskaiDailyMix(projectId, mix, source.version, controller.signal);
      if (controller.signal.aborted) return false;
      client.setQueryData<DneskaiDailyMixRead | null>(key, current => current?.version && databaseVersion(current.version)! > databaseVersion(read.version!)! ? current : read);
      setSource(read); setDraft(read.mix); immediateDraft.current = read.mix; setNotice('saved'); return true;
    } catch (error) {
      if (!controller.signal.aborted) { setNotice(error instanceof DneskaiDailyMixRequestError && error.code === 'daily-mix-conflict' ? 'changed' : 'failed'); void client.invalidateQueries({ queryKey: key }); }
      return false;
    } finally { if (!controller.signal.aborted) { operation.current = null; setPending(false); } }
  }
  const titleId = useId(), newsId = useId(), educationId = useId(), problemId = useId();
  const posts = draft ? draft.newsPerDay + draft.educationPerDay : 0;
  const tooFew = !!draft && posts > draft.slots.length;
  useUnsavedDraft({ get pending() { return operation.current !== null; },
    get dirty() { const current = immediateDraft.current ?? draft; return !preview && !!current && !!source && !sameDneskaiDailyMix(current, source.mix); },
    canSave: !pending && !tooFew && available && !changed && !preview, save,
    discard: () => { if (source) updateDraft(source.mix); } });
  if (!source && query.data === null) return showDisabled ? <p role="status" className="text-sm text-foreground-muted">{t.disabled}</p> : null;
  if (!source && query.isPending) return <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>;
  if (!source && query.isError) return <div role="alert"><p className="text-sm text-risk">{t.unavailable}</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>{t.retry}</Button></div>;
  if (!draft || !source) return null;
  const toggle = (time: DneskaiDailyMixTime, on: boolean) => updateDraft({ ...draft, slots: on ? dneskaiActiveSlotTimes({ slots: [...draft.slots, time] }) : draft.slots.filter((item) => item !== time) });
  const select = (id: string, label: string, value: number, change: (value: number) => void) => <label htmlFor={id} className="flex min-w-0 flex-col gap-1 text-sm">
    <span className="font-medium">{label}</span>
    <select id={id} value={value} onChange={(event) => change(Number(event.target.value))} className="h-11 w-24 md:h-8 rounded-md border border-border-strong bg-surface px-2 text-sm tabular focus-ring" disabled={pending || !available}>
      {COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}
    </select>
  </label>;
  return <section aria-labelledby={titleId} className="form-frame min-w-0 space-y-4" data-testid="dneskai-daily-mix">
    <div className="min-w-0"><h2 id={titleId} className="text-sm font-semibold">{t.title}</h2><p className="mt-1 max-w-3xl text-sm text-foreground-muted">{t.intro}</p></div>
    {preview && <p className="text-sm text-foreground-muted">{t.preview}</p>}
    {!available && <div role="alert"><p className="text-sm text-risk">{query.data === null ? t.disabled : t.unavailable}</p><Button variant="outline" size="sm" disabled={pending || query.isFetching} onClick={() => void query.refetch()}>{t.retry}</Button></div>}
    {changed && <div role="alert" className="space-y-2"><p className="text-sm text-risk">{t.changed}</p><Button type="button" variant="outline" disabled={pending} onClick={() => { if (query.data) { setSource(query.data); updateDraft(query.data.mix); } }}>{t.reload}</Button></div>}
    {!source.stored && !preview && <p className="text-xs text-foreground-muted">{t.defaultNote}</p>}
    <form aria-busy={pending} className="grid gap-4 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-start" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="flex flex-wrap gap-3">
        {select(newsId, t.news, draft.newsPerDay, (value) => updateDraft({ ...draft, newsPerDay: value }))}
        {select(educationId, t.education, draft.educationPerDay, (value) => updateDraft({ ...draft, educationPerDay: value }))}
      </div>
      <fieldset className="space-y-2" aria-describedby={tooFew ? problemId : undefined}>
        <legend className="text-sm font-medium">{t.times}</legend>
        <div className="flex flex-wrap gap-x-3">
          {DNESKAI_DAILY_MIX_TIMES.map((time) => <label key={time} className="flex min-h-11 items-center gap-2 text-sm tabular md:min-h-8">
            <Checkbox checked={draft.slots.includes(time)} onCheckedChange={(value) => toggle(time, value === true)} disabled={pending || !available || (draft.slots.length === 1 && draft.slots.includes(time))} />
            {time}
          </label>)}
        </div>
        {tooFew && <p role="alert" id={problemId} className="text-xs text-risk">{t.tooFew(posts, draft.slots.length)}</p>}
      </fieldset>
      <div className="flex flex-wrap items-center gap-3 lg:max-w-40 lg:pt-6">
        <Button type="submit" disabled={preview || tooFew || pending || !available || changed}>{pending ? t.saving : t.save}</Button>
        <p role={notice === 'saved' ? 'status' : 'alert'} className={`text-sm empty:hidden ${notice === 'saved' ? '' : 'text-risk'}`}>{notice && !(changed && notice === 'changed') ? t[notice] : ''}</p>
      </div>
    </form>
  </section>;
}
