'use client';

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '@/lib/i18n';
import { useNow } from '@/lib/use-now';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { qk } from '@/lib/queries/keys';
import { pragueMarketingDate } from '@/lib/marketing/weekly-planning';
import { applyCalendarImport, CalendarImportError, previewCalendarImport, type CalendarImportPreview, type CalendarImportScope } from '@/lib/marketing/calendar-import-client';

export function CalendarImport({ onImported, disabled = false }: { onImported: () => void; disabled?: boolean }) {
  const { lang } = useLang(), cs = lang === 'cs', owner = useOwnerPreferences(), client = useQueryClient(), now = useNow(), id = useId();
  const [brand, setBrand] = useState<'dneskai' | 'devshark'>('dneskai');
  const [chosenStart, setStart] = useState<string | null>(null);
  const start = chosenStart ?? (now ? pragueMarketingDate(now) : '');
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null), [message, setMessage] = useState(''), [failed, setFailed] = useState(false), [page, setPage] = useState(0);
  const lifetime = useRef(new AbortController()), active = useRef<(CalendarImportScope & { apply: boolean }) | null>(null);
  const focus = useRef<'preview' | 'apply' | null>(null), previewButton = useRef<HTMLButtonElement>(null), applyButton = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
    return () => {
      if (active.current?.apply) void client.invalidateQueries({ queryKey: qk.marketingState, refetchType: 'none' });
      lifetime.current.abort(); active.current = null;
    };
  }, [client]);
  useLayoutEffect(() => {
    if (busy || !focus.current) return;
    (focus.current === 'apply' ? applyButton : previewButton).current?.focus(); focus.current = null;
  }, [busy, preview]);
  useUnsavedDraft({ get dirty() { return false; }, get pending() { return active.current?.apply === true; }, canSave: false, save: async () => false });
  function reset() { setPreview(null); setMessage(''); setFailed(false); setPage(0); }
  async function run(apply: boolean) {
    if (disabled || active.current || !owner || !start || (apply && !preview)) return;
    const original = owner.capture();
    const scope = { ownerId: original.ownerId, signal: AbortSignal.any([original.signal, lifetime.current.signal]), apply };
    if (scope.signal.aborted) return;
    const intent = { brand, startsOn: start }, capturedPreview = preview;
    active.current = scope; setBusy(apply ? 'apply' : 'preview'); setFailed(false); setMessage(''); setStart(start);
    if (!apply) setPreview(null);
    try {
      if (apply && capturedPreview) {
        await applyCalendarImport(scope, intent, capturedPreview); scope.signal.throwIfAborted();
        setPreview(null); setMessage(cs ? 'Import potvrzen. Plán najdeš v kalendáři.' : 'Import confirmed. Review the plan in the calendar.'); focus.current = 'preview';
        try { onImported(); } catch { setMessage(cs ? 'Import potvrzen. Obnov kalendář, aby se načetl aktuální plán.' : 'Import confirmed. Refresh the calendar to load the current plan.'); }
      } else {
        const result = await previewCalendarImport(scope, intent); scope.signal.throwIfAborted();
        setPreview(result); setPage(0); focus.current = 'apply';
      }
    } catch (error) {
      if (!scope.signal.aborted) {
        setPreview(null); setFailed(true); focus.current = 'preview';
        setMessage(error instanceof CalendarImportError && error.reason === 'changed'
          ? cs ? 'Zdroj, přiřazení tipů nebo účet se změnil. Nejdřív znovu zkontroluj plán.' : 'The source, tip matches or account changed. Preview the plan again first.'
          : apply ? cs ? 'Uložení není potvrzené. Před dalším pokusem znovu zkontroluj plán.' : 'Save is unconfirmed. Preview the plan again before retrying.'
          : cs ? 'Plán nelze načíst. Ověř připojení a zkus kontrolu znovu.' : 'The plan could not be loaded. Check the connection and preview again.');
      }
    } finally {
      if (active.current === scope) { active.current = null; if (!scope.signal.aborted) setBusy(null); }
    }
  }
  const locked = disabled || busy !== null || !owner;
  const references = preview ? [...preview.report.unmatchedTipTitles, ...preview.report.ambiguousTipTitles] : [];
  return <section aria-labelledby={`${id}-title`} aria-busy={busy !== null} className="mx-auto mb-5 w-full max-w-3xl space-y-3 rounded-lg border border-border bg-surface p-4">
    <div className="space-y-1"><h2 id={`${id}-title`} className="text-sm font-semibold">{cs ? 'Převzít plán z BoardlessAI' : 'Import the BoardlessAI plan'}</h2>
      <p className="text-xs text-foreground-muted">{cs ? 'Sedm dní ke kontrole. Pozdější nápady zůstanou v zásobníku; staré nabídky a zprávy potřebují nový podklad.' : 'Seven days for review. Later ideas stay in the backlog; old offers and news need a current source.'}</p></div>
    <div className="grid items-end gap-3 sm:flex sm:flex-wrap">
      <label className="min-w-0 text-xs sm:w-36">{cs ? 'Značka' : 'Brand'}<select className="mt-1 block h-11 w-full rounded-md border border-border-strong bg-surface px-3 text-foreground focus-ring md:h-8" value={brand} disabled={locked} onChange={event => { if (active.current) return; setBrand(event.target.value === 'devshark' ? 'devshark' : 'dneskai'); reset(); }}><option value="dneskai">DNESKAi</option><option value="devshark">devShark</option></select></label>
      <label className="min-w-0 text-xs sm:w-40">{cs ? 'První den' : 'First day'}<Input type="date" className="mt-1" value={start} disabled={locked} onChange={event => { if (active.current) return; setStart(event.target.value); reset(); }}/></label>
      <Button ref={previewButton} variant="outline" disabled={locked || !start} onClick={() => void run(false)}>{busy === 'preview' ? cs ? 'Probíhá kontrola…' : 'Checking…' : cs ? 'Zkontrolovat plán' : 'Preview plan'}</Button>
    </div>
    {preview && <div className="space-y-3 border-t border-border pt-3 text-xs">
      <p className="tabular">{preview.campaign.starts_on} – {preview.campaign.ends_on} · {preview.report.outputCount} {cs ? 'záznamů' : 'entries'} · {preview.report.held} {cs ? 'ke kontrole' : 'held for review'} · {preview.report.backlog} {cs ? 'v zásobníku' : 'in backlog'}{preview.report.completed > 0 && ` · ${preview.report.completed} ${cs ? 'hotovo' : 'completed'}`}</p>
      {references.length > 0 && <details><summary className="cursor-pointer py-2 focus-ring">{cs ? 'Odkazy na tipy ke kontrole' : 'Tip references to review'}: {preview.report.unmatchedTipTitles.length} {cs ? 'nenalezených' : 'unmatched'} · {preview.report.ambiguousTipTitles.length} {cs ? 'nejednoznačných' : 'ambiguous'}</summary>
        <ul className="list-inside list-disc space-y-1 break-words py-2">{references.slice(page * 50, (page + 1) * 50).map((title, index) => <li key={`${page}-${index}`}>{title}</li>)}</ul>
        {references.length > 50 && <div className="flex flex-wrap items-center gap-2"><Button variant="outline" disabled={page === 0} onClick={() => setPage(value => value - 1)}>{cs ? 'Předchozí' : 'Previous'}</Button><span className="tabular">{page * 50 + 1}–{Math.min((page + 1) * 50, references.length)} / {references.length}</span><Button variant="outline" disabled={(page + 1) * 50 >= references.length} onClick={() => setPage(value => value + 1)}>{cs ? 'Další' : 'Next'}</Button></div>}
      </details>}
      <Button ref={applyButton} className="w-full sm:w-auto" disabled={locked} onClick={() => void run(true)}>{busy === 'apply' ? cs ? 'Importuji…' : 'Importing…' : cs ? 'Importovat plán' : 'Import plan'}</Button>
    </div>}
    {message && <p role={failed ? 'alert' : 'status'} className="text-xs">{message}</p>}
  </section>;
}
