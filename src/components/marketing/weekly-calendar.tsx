'use client';

import { useMemo,useRef,useState } from 'react';
import { useGuardedNavigation } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { CollectionPagination } from '@/components/ui/collection-pagination';
import { collectionPage } from '@/lib/collection-page';
import { CalendarSlot,CalendarSlotEditor } from './calendar-slot';
import { marketingCalendarGroups,marketingCalendarCopy,marketingCalendarKind,marketingCalendarStatus,type MarketingCalendarGroup } from '@/lib/marketing/calendar-view';
import type { MarketingState } from '@/lib/marketing/client';
type Entry=MarketingState['entries'][number];type Campaign=MarketingState['campaigns'][number];
const PAGE_SIZE=20;
/** Imported authored dates, local bounded pages and one retained slot editor. */
export function WeeklyMarketingCalendar({state,brand,lang,disabled,activationDisabled=disabled,slotDisabled=disabled,readPending=false,readSerial=0,onReload=async()=>{},busy,onActivate,onChanged}:{
 state:MarketingState;brand:string;lang:string;disabled:boolean;activationDisabled?:boolean;slotDisabled?:boolean;readPending?:boolean;readSerial?:number;onReload?:()=>Promise<void>;busy:string|null;onActivate:(campaign:Campaign)=>void;onChanged:()=>void;
}){
 const locale=lang==='cs'?'cs':'en',t=marketingCalendarCopy[locale],navigate=useGuardedNavigation();
 const [showBacklog,setShowBacklog]=useState(false),[editing,setEditing]=useState<{entry:Entry;campaign:Campaign;key:number}|null>(null),editorKey=useRef(0);
 const groups=useMemo(()=>marketingCalendarGroups(state.campaigns,state.entries),[state.campaigns,state.entries]);
 const openEditor=(entry:Entry,campaign:Campaign)=>navigate(()=>setEditing({entry:{...entry},campaign:{...campaign},key:++editorKey.current}));
 return <div className="space-y-5">
  <div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-prose text-xs text-foreground-muted">{t.intro}</p><Button variant="outline" aria-pressed={showBacklog} onClick={()=>navigate(()=>setShowBacklog(value=>!value))}>{showBacklog?t.week:t.backlog}</Button></div>
  {groups.filter(group=>brand==='all'||group.campaign.brand===brand).map(group=><CampaignCalendar key={JSON.stringify([group.campaign.id,group.campaign.source_hash])} group={group} lang={locale} showBacklog={showBacklog} activationDisabled={activationDisabled||busy===group.campaign.id} slotDisabled={slotDisabled} onActivate={()=>onActivate(group.campaign)} onOpen={entry=>openEditor(entry,group.campaign)}/>)}
  {editing&&<CalendarSlotEditor key={editing.key} original={editing.entry} campaign={editing.campaign} current={state.entries.find(row=>row.id===editing.entry.id)} currentCampaign={state.campaigns.find(row=>row.id===editing.campaign.id)} sources={state.sources} disabled={slotDisabled} readPending={readPending} readSerial={readSerial} onReload={onReload} onClose={()=>navigate(()=>setEditing(null))} onDiscard={()=>setEditing(null)} onReset={()=>{const entry=state.entries.find(row=>row.id===editing.entry.id),campaign=state.campaigns.find(row=>row.id===editing.campaign.id);if(entry&&campaign)openEditor(entry,campaign);}} onSaved={()=>{setEditing(null);onChanged();}}/>}
 </div>;
}
function CampaignCalendar({group,lang,showBacklog,activationDisabled,slotDisabled,onActivate,onOpen}:{group:MarketingCalendarGroup;lang:'en'|'cs';showBacklog:boolean;activationDisabled:boolean;slotDisabled:boolean;onActivate:()=>void;onOpen:(entry:Entry)=>void}){
 const t=marketingCalendarCopy[lang],cs=lang==='cs',navigate=useGuardedNavigation(),{campaign}=group;
 const [indices,setIndices]=useState({week:0,backlog:0,retired:0,history:0}),view=showBacklog?'backlog':'week';
 const visible=collectionPage(group[view],indices[view],PAGE_SIZE),retired=collectionPage(group.retired,indices.retired,PAGE_SIZE),history=collectionPage(group.history,indices.history,PAGE_SIZE);
 const controls=(page:typeof visible,key:keyof typeof indices,label:string)=><CollectionPagination page={page} onPage={index=>navigate(()=>setIndices(previous=>({...previous,[key]:index})))} label={label} previous={t.previous} next={t.next} range={(from,to,total)=>cs?`${from}–${to} z ${total}`:`${from}–${to} of ${total}`}/>;
 return <section className="mx-auto max-w-5xl" aria-label={`${campaign.name} ${showBacklog?'backlog':campaign.starts_on}`}>
  <div className="mb-2 flex flex-wrap items-center justify-between gap-3"><h2 className="min-w-0 break-words text-sm font-semibold">{campaign.name} · {showBacklog?t.backlogTitle:`${campaign.starts_on} – ${group.end}`}</h2>{!showBacklog&&campaign.status==='draft'&&<Button variant="outline" disabled={activationDisabled} onClick={onActivate}>{t.use}</Button>}</div>
  <p className="mb-3 text-xs text-foreground-muted">{cs?`${group.week.length} v týdnu · ${group.backlog.length} nápadů v zásobníku · ${group.retired.length} vyřazených zadání`:`${group.week.length} this week · ${group.backlog.length} backlog ideas · ${group.retired.length} retired briefs`}</p>
  {showBacklog&&<p className="mb-3 max-w-prose text-xs text-foreground-muted">{t.backlogHelp}</p>}
  {!visible.total?<p className="text-sm text-foreground-muted">{t.empty}</p>:<div className="divide-y divide-border rounded-lg border border-border bg-surface">{visible.items.map(entry=><div key={entry.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-3 text-xs xl:grid-cols-[minmax(0,1fr)_9rem_11rem_auto]">
   <span className="col-span-2 min-w-0 break-words font-medium xl:col-span-1">{entry.title}</span><time dateTime={entry.date} className="col-start-1 row-start-2 min-w-0 break-words text-foreground-muted xl:col-start-auto xl:row-start-auto">{entry.date} {entry.local_time}</time><span className="col-start-1 row-start-3 min-w-0 break-words text-foreground-muted xl:col-start-auto xl:row-start-auto">{marketingCalendarStatus(entry,lang)} · {marketingCalendarKind(entry.kind,lang)} · {entry.platform}</span><CalendarSlot entry={entry} disabled={slotDisabled} onOpen={()=>onOpen(entry)}/>
  </div>)}</div>}
  {controls(visible,view,showBacklog?t.backlogPages:t.weekPages)}
  {retired.total>0&&<details className="mt-3 text-xs"><summary className="cursor-pointer">{t.retiredPages} ({retired.total})</summary><ul className="mt-2 space-y-2">{retired.items.map(entry=><li key={entry.id} className="break-words"><span>{entry.title}</span> · <time dateTime={entry.date}>{entry.date}</time></li>)}</ul>{controls(retired,'retired',t.retiredPages)}<p className="mt-2 max-w-prose text-foreground-muted">{t.retiredHelp}</p></details>}
  {history.total>0&&<details className="mt-3 text-xs"><summary className="cursor-pointer">{t.historyPages} ({history.total})</summary><ul className="mt-2 space-y-2">{history.items.map(entry=><li key={entry.id} className="break-words"><span>{entry.title}</span> · <time dateTime={entry.date}>{entry.date}</time> · {marketingCalendarStatus(entry,lang)}</li>)}</ul>{controls(history,'history',t.historyPages)}<p className="mt-2 max-w-prose text-foreground-muted">{t.historyHelp}</p></details>}
 </section>;
}
