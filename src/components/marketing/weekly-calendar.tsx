'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { CalendarSlot } from './calendar-slot';
import { calendarImportEndDate } from '@/lib/marketing/calendar-import-contracts';
import type { MarketingState } from '@/lib/marketing/client';

/** The current seven days and the retained idea bank are separate views, never a silent date shift. */
export function WeeklyMarketingCalendar({ state, brand, lang, disabled, busy, onActivate, onChanged }: {
  state: MarketingState; brand: string; lang: string; disabled: boolean; busy: string | null;
  onActivate: (campaign: MarketingState['campaigns'][number]) => void; onChanged: () => void;
}) {
  const cs = lang === 'cs';
  const [showBacklog, setShowBacklog] = useState(false);
  const campaigns = state.campaigns.filter(c => brand === 'all' || c.brand === brand);
  return <div className="space-y-5">
    <div className="border-l-2 border-border pl-3 text-sm">
      <p>{cs ? 'devShark: v neděli připravíme a zkontrolujeme celý týden. Denně 1 IG příspěvek, 2 příspěvky na Threads a 3 Stories.' : 'devShark: prepare and review the full week on Sunday. Each day: 1 Instagram post, 2 Threads posts and 3 Stories.'}</p>
      <p className="mt-2">{cs ? 'DNESKAi: každý den nový návrh z aktuálního finálního článku BoardlessAI. V neděli vyhodnotíme předchozích sedm dní a vybereme další témata.' : 'DNESKAi: a fresh draft each day from a current final BoardlessAI article. Review the previous seven days and select the next topics on Sunday.'}</p>
      <p className="mt-2 text-xs text-foreground-muted">{cs ? 'Každá hotová verze potřebuje tvoje schválení. Stories zatím vyžadují dokončení importu a živé ověření publikování; propojení Threads a měření dosahu čeká na nastavení.' : 'Every finished revision needs your approval. Stories still need draft import and live publishing verification; Threads account access and reach measurement await setup.'}</p>
    </div>
    <Button variant="outline" aria-pressed={showBacklog} onClick={() => setShowBacklog(value => !value)}>{showBacklog ? (cs ? 'Zobrazit sedmidenní plán' : 'Show seven-day plan') : (cs ? 'Zobrazit zásobník nápadů' : 'Show idea backlog')}</Button>
    {campaigns.map(campaign => {
      // This view groups authored dates; it does not schedule a publication.
      const window = { startDate: campaign.starts_on, endDateInclusive: calendarImportEndDate(campaign.starts_on) };
      const entries = state.entries.filter(entry => entry.campaign_id === campaign.id);
      const archived = entries.filter(entry => entry.status === 'archived');
      const backlog = entries.filter(entry => entry.status !== 'archived' && !['done', 'published'].includes(entry.status) && (entry.status === 'backlog' || entry.date < window.startDate || entry.date > window.endDateInclusive));
      const backlogIds = new Set(backlog.map(entry => entry.id));
      const week = entries.filter(entry => entry.status !== 'archived' && !backlogIds.has(entry.id) && entry.date >= window.startDate && entry.date <= window.endDateInclusive);
      const visible = showBacklog ? backlog : week;
      return <section key={campaign.id} aria-label={`${campaign.name} ${showBacklog ? 'backlog' : window.startDate}`}>
        <div className="mb-2 flex flex-wrap items-center gap-3"><h2 className="text-sm font-semibold">{campaign.name} · {showBacklog ? (cs ? 'Zásobník' : 'Backlog') : `${window.startDate} – ${window.endDateInclusive}`}</h2>
          {!showBacklog && campaign.status === 'draft' && <Button variant="outline" disabled={disabled || busy === campaign.id} onClick={() => onActivate(campaign)}>{cs ? 'Použít tento plán' : 'Use this plan'}</Button>}
        </div>
        <p className="mb-3 text-xs text-foreground-muted">{cs ? `${week.length} v týdnu · ${backlog.length} nápadů v zásobníku · ${archived.length} vyřazených zadání` : `${week.length} this week · ${backlog.length} backlog ideas · ${archived.length} retired briefs`}</p>
        {showBacklog && <p className="mb-3 text-xs text-foreground-muted">{cs ? 'Původní data ukazují starý plán, ne nový termín publikace. Nápad znovu vybereme a upravíme podle výsledků týdne a platného zdroje.' : 'Original dates belong to the old plan, not a new publication schedule. Reconsider each idea using weekly results and a current source.'}</p>}
        {!visible.length ? <p className="text-sm text-foreground-muted">{cs ? 'V tomto pohledu zatím nejsou žádné položky.' : 'There are no entries in this view yet.'}</p> : <div className="divide-y divide-border rounded-lg border border-border bg-surface">{visible.map(entry => <div key={entry.id} className="grid gap-1 px-3 py-3 text-xs sm:grid-cols-[110px_1fr_150px]">
          <time>{entry.date} {entry.local_time}</time><span className="break-words">{entry.title}</span>
          <span className="text-foreground-muted">{entry.status === 'published' ? (cs ? 'Publikováno' : 'Published') : entry.status === 'done' ? (cs ? 'Dokončeno' : 'Done') : entry.kind === 'story' ? (cs ? 'Stories: publikování čeká' : 'Stories: publishing held') : entry.status === 'backlog' ? (cs ? 'Nápad k přepracování' : 'Idea to revisit') : entry.needs_review ? (cs ? 'Čeká na podklad / kontrolu' : 'Needs source / review') : (cs ? 'Naplánováno' : 'Planned')} · {entry.platform}</span>
          <CalendarSlot entry={entry} campaign={campaign} sources={state.sources} disabled={disabled} onChanged={onChanged}/>
        </div>)}</div>}
        {archived.length > 0 && <details className="mt-3 text-xs"><summary className="cursor-pointer">{cs ? `Vyřazená zadání (${archived.length})` : `Retired briefs (${archived.length})`}</summary><ul className="mt-2 space-y-2">{archived.map(entry => <li key={entry.id}>{entry.title} · {entry.date}</li>)}</ul><p className="mt-2 text-foreground-muted">{cs ? 'Původní záznamy zůstávají uložené pro dohledání. Nečekají na publikování.' : 'Original records remain available for reference. They are not queued for publishing.'}</p></details>}
      </section>;
    })}
  </div>;
}
