import { calendarImportEndDate } from './calendar-import-contracts';
import type { MarketingState } from './client';
type Entry=MarketingState['entries'][number];
export type MarketingCalendarGroup={campaign:MarketingState['campaigns'][number];end:string;week:Entry[];backlog:Entry[];retired:Entry[];history:Entry[]};
/** One pass over complete selected-plan entries, preserving their authored order.
 * Completed entries outside the seven-day window remain history, never ideas. */
export function marketingCalendarGroups(campaigns:MarketingState['campaigns'],entries:MarketingState['entries']):MarketingCalendarGroup[]{
 const groups=campaigns.map(campaign=>({campaign,end:calendarImportEndDate(campaign.starts_on),week:[] as Entry[],backlog:[] as Entry[],retired:[] as Entry[],history:[] as Entry[]}));
 const byId=new Map(groups.map(group=>[group.campaign.id,group]));
 for(const entry of entries){const group=byId.get(entry.campaign_id);if(!group)continue;
  const outside=entry.date<group.campaign.starts_on||entry.date>group.end,completed=entry.status==='done'||entry.status==='published';
  if(entry.status==='archived')group.retired.push(entry);else if(completed&&outside)group.history.push(entry);else if(entry.status==='backlog'||outside)group.backlog.push(entry);else group.week.push(entry);
 }
 return groups;
}
const en={intro:'Plan entries keep their original dates. Preparing a slot uses a current source; each new post still needs separate approval.',week:'Show seven-day plan',backlog:'Show idea backlog',backlogTitle:'Backlog',use:'Use this plan',weekPages:'Week entries',backlogPages:'Backlog entries',retiredPages:'Retired briefs',historyPages:'Completed history',previous:'Previous',next:'Next',empty:'There are no entries in this view.',backlogHelp:'Ideas keep their original dates; they are not publication bookings. Choose a current source and time when preparing one.',retiredHelp:'Original records remain available for reference. They are not queued for publishing.',historyHelp:'Completed entries outside this seven-day plan. Their original dates are kept.',planned:'Planned',blocked:'Blocked',needsReview:'Needs source / review',done:'Done',published:'Published',idea:'Idea to revisit',retired:'Retired',unknown:'Needs review',post:'Post',carousel:'Carousel',thread:'Thread',story:'Story',task:'Task',entry:'Entry'};
const cs:typeof en={intro:'Položky plánu si ponechávají původní data. Příprava slotu použije aktuální podklad; každý nový příspěvek pak potřebuje samostatné schválení.',week:'Zobrazit sedmidenní plán',backlog:'Zobrazit zásobník nápadů',backlogTitle:'Zásobník',use:'Použít tento plán',weekPages:'Položky týdne',backlogPages:'Nápady v zásobníku',retiredPages:'Vyřazená zadání',historyPages:'Dokončená historie',previous:'Předchozí',next:'Další',empty:'V tomto pohledu nejsou žádné položky.',backlogHelp:'Nápady si ponechávají původní data; nejde o rezervace publikování. Při přípravě vyberte aktuální podklad a čas.',retiredHelp:'Původní záznamy zůstávají dostupné pro dohledání. Nečekají na publikování.',historyHelp:'Dokončené položky mimo tento sedmidenní plán. Původní data zůstávají zachovaná.',planned:'Naplánováno',blocked:'Blokováno',needsReview:'Čeká na podklad / kontrolu',done:'Dokončeno',published:'Publikováno',idea:'Nápad k přepracování',retired:'Vyřazeno',unknown:'Čeká na kontrolu',post:'Příspěvek',carousel:'Karusel',thread:'Vlákno',story:'Story',task:'Úkol',entry:'Položka'};
export const marketingCalendarCopy={en,cs};
export function marketingCalendarStatus(entry:Entry,lang:'en'|'cs'){
 const t=marketingCalendarCopy[lang];
 if(entry.status==='published')return t.published;if(entry.status==='done')return t.done;if(entry.status==='archived')return t.retired;if(entry.status==='backlog')return t.idea;if(entry.status==='blocked')return t.blocked;if(entry.status==='planned')return entry.needs_review?t.needsReview:t.planned;return t.unknown;
}
export function marketingCalendarKind(kind:string,lang:'en'|'cs'){
 const t=marketingCalendarCopy[lang];return kind==='post'?t.post:kind==='carousel'?t.carousel:kind==='thread'?t.thread:kind==='story'?t.story:kind==='task'?t.task:t.entry;
}
