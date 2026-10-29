'use client';
import { useId,useLayoutEffect,useRef,useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useLang } from '@/lib/i18n';
import { useNow } from '@/lib/use-now';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from '@/components/ui/dialog';
import { qk } from '@/lib/queries/keys';
import { pragueScheduledAt } from '@/lib/marketing/clock';
import { releaseCalendarSlot,CalendarReleaseError,type CalendarReleaseScope } from '@/lib/marketing/calendar-release';
import { calendarReleaseCopy } from '@/lib/marketing/calendar-release-copy';
import type { MarketingState } from '@/lib/marketing/client';
type Entry=MarketingState['entries'][number];type Campaign=MarketingState['campaigns'][number];type Source=MarketingState['sources'][number];
const sourceKey=(source:Source)=>JSON.stringify([source.brand,source.id,source.packet.sourceRevision,source.packet.contentHash]);
export function CalendarSlot({entry,disabled,onOpen}:{entry:Entry;disabled:boolean;onOpen:()=>void}){
 const {lang}=useLang();
 if(!['instagram','threads'].includes(entry.platform)||!['post','carousel','thread'].includes(entry.kind)||['done','published','archived'].includes(entry.status))return null;
 return <div className="col-start-2 row-span-2 row-start-2 xl:col-start-auto xl:row-span-1 xl:row-start-auto"><Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={onOpen}>{calendarReleaseCopy[lang].opener}</Button></div>;
}
export function CalendarSlotEditor({original,campaign,current,currentCampaign,sources,disabled,readPending,readSerial,onReload,onClose,onDiscard,onReset,onSaved}:{original:Entry;campaign:Campaign;current?:Entry;currentCampaign?:Campaign;sources:Source[];disabled:boolean;readPending:boolean;readSerial:number;onReload:()=>Promise<void>;onClose:()=>void;onDiscard:()=>void;onReset:()=>void;onSaved:()=>void}){
 const {lang}=useLang(),t=calendarReleaseCopy[lang],noticeId=useId(),owner=useOwnerPreferences(),client=useQueryClient(),now=useNow();
 const [source,setSource]=useState<Source|null>(null),[date,setDate]=useState(original.date),[time,setTime]=useState(original.local_time??'09:00');
 const [busy,setBusy]=useState(false),[problem,setProblem]=useState<'changed'|'unconfirmed'|'invalid'|null>(null),[attemptRead,setAttemptRead]=useState<number|null>(null),[saved,setSaved]=useState(false);
 const lifetime=useRef(new AbortController()),active=useRef<CalendarReleaseScope|null>(null),confirmed=useRef(false),reloadBusy=useRef(false);
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>{if(active.current&&!confirmed.current)void client.invalidateQueries({queryKey:qk.marketingState,refetchType:'none'});lifetime.current.abort();active.current=null;};},[client]);
 const present=!!current&&!!currentCampaign;
 const changed=present&&(!/^[a-f0-9]{64}$/.test(original.capture_hash??'')||current.capture_hash!==original.capture_hash||currentCampaign.source_hash!==campaign.source_hash||currentCampaign.status==='archived');
 const inactive=present&&currentCampaign.status!=='active';
 const needsRead=attemptRead!==null&&(readSerial<=attemptRead||disabled||readPending);
 const choices=sources.filter(item=>now!==null&&item.brand===campaign.brand&&item.eligible&&(item.packet.expiresAt===null||Date.parse(item.packet.expiresAt)>now.getTime()));
 const selected=source?choices.find(item=>sourceKey(item)===sourceKey(source)):undefined;
 const sourceChanged=!!source&&!selected;
 const paused=now===null||disabled||busy||saved||!owner||!present||changed||inactive||needsRead;
 let validTime=false;try{validTime=now!==null&&date>=campaign.starts_on&&date<=campaign.ends_on&&Date.parse(pragueScheduledAt(date,time))>now.getTime();}catch{}
 const canSave=!paused&&!!selected&&validTime;
 const dirty=source!==null||date!==original.date||time!==(original.local_time??'09:00');
 useUnsavedDraft({get dirty(){return dirty&&!confirmed.current;},get pending(){return active.current!==null;},canSave,save:()=>save(),discard:onDiscard});
 async function reload(){if(reloadBusy.current||active.current)return;reloadBusy.current=true;try{await onReload();}finally{reloadBusy.current=false;}}
 async function save():Promise<boolean>{
  if(disabled||active.current||saved||!owner||!present||changed||inactive||needsRead)return false;
  const chosen=source&&sources.find(item=>item.brand===campaign.brand&&sourceKey(item)===sourceKey(source)&&item.eligible&&(item.packet.expiresAt===null||Date.parse(item.packet.expiresAt)>Date.now()));
  let future=false;try{future=date>=campaign.starts_on&&date<=campaign.ends_on&&Date.parse(pragueScheduledAt(date,time))>Date.now();}catch{}
  if(!chosen||!future){setProblem('invalid');return false;}
  let scope:CalendarReleaseScope;try{const captured=owner.capture();scope={ownerId:captured.ownerId,signal:AbortSignal.any([captured.signal,lifetime.current.signal])};}catch{return false;}if(scope.signal.aborted)return false;
  const intent={id:original.id,expectedEntryHash:original.capture_hash,expectedCampaignHash:campaign.source_hash,sourceId:chosen.id,expectedSourceHash:source!.packet.contentHash,expectedSourceRevision:source!.packet.sourceRevision,date,time,kind:original.platform==='instagram'?'carousel' as const:'thread' as const};
  active.current=scope;setBusy(true);setProblem(null);
  try{
   await releaseCalendarSlot(scope,intent,original);scope.signal.throwIfAborted();confirmed.current=true;active.current=null;setSaved(true);setAttemptRead(null);setBusy(false);
   void client.invalidateQueries({queryKey:qk.marketingState,refetchType:'none'});
   try{onSaved();}catch{setSaved(true);}return true;
  }catch(error){if(!scope.signal.aborted){void client.invalidateQueries({queryKey:qk.marketingState,refetchType:'none'});setAttemptRead(readSerial);setProblem(error instanceof CalendarReleaseError&&error.reason==='changed'?'changed':'unconfirmed');}return false;}
  finally{if(active.current===scope){active.current=null;if(!scope.signal.aborted)setBusy(false);}}
 }
 const notice=saved?t.savedReload:!owner?t.ownerUnavailable:now===null?t.checking:!present?t.missing:changed?t.changed:inactive?t.inactive:readPending?t.checking:needsRead?(problem==='changed'?t.refused:t.unconfirmed):disabled?t.paused:!choices.length?t.noSource:sourceChanged?t.sourceChanged:problem==='invalid'||!validTime?t.invalid:attemptRead!==null?t.rechecked:null;
 return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="max-w-3xl" aria-busy={busy}><DialogHeader><DialogTitle>{t.title} · {original.title}</DialogTitle><DialogDescription>{t.description}</DialogDescription></DialogHeader>
  <form noValidate onSubmit={event=>{event.preventDefault();void save();}} className="space-y-4">
   <div className="grid min-w-0 grid-cols-2 gap-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem]">
    <label className="col-span-2 min-w-0 text-xs md:col-span-1">{t.source}<select className="mt-1 block h-11 w-full max-w-full rounded border border-border bg-surface px-2 text-foreground md:h-8" value={source?sourceKey(source):''} aria-invalid={sourceChanged||undefined} aria-describedby={notice?noticeId:undefined} disabled={paused} onChange={event=>{const selected=choices.find(item=>sourceKey(item)===event.target.value);setSource(selected?structuredClone(selected):null);setProblem(null);}}><option value="">{t.choose}</option>{sourceChanged&&source&&<option value={sourceKey(source)} disabled>{t.unavailableChoice}: {source.packet.content.title}</option>}{choices.map(item=><option key={sourceKey(item)} value={sourceKey(item)}>{item.packet.content.title}</option>)}</select></label>
    <label className="min-w-0 text-xs">{t.date}<Input type="date" className="mt-1 min-w-0" value={date} min={campaign.starts_on} max={campaign.ends_on} aria-invalid={!validTime||undefined} aria-describedby={notice?noticeId:undefined} disabled={paused} onChange={event=>{setDate(event.target.value);setProblem(null);}}/></label>
    <label className="min-w-0 text-xs">{t.time}<Input type="time" className="mt-1 min-w-0" value={time} aria-invalid={!validTime||undefined} aria-describedby={notice?noticeId:undefined} disabled={paused} onChange={event=>{setTime(event.target.value);setProblem(null);}}/></label>
   </div>
   {source&&<a className="inline-block text-xs underline focus-ring" href={source.packet.canonicalUrl} target="_blank" rel="noreferrer">{t.openSource}</a>}
   {notice&&<p id={noticeId} role={saved||(!needsRead&&attemptRead!==null&&!changed&&!sourceChanged)?'status':'alert'} className="break-words text-xs">{notice}</p>}
   <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" disabled={busy||readPending} onClick={()=>void reload()}>{t.reload}</Button>{present&&(changed||saved)&&<Button type="button" variant="outline" disabled={busy||readPending||disabled} onClick={onReset}>{t.reset}</Button>}</div>
   <div className="grid auto-rows-fr grid-cols-2 gap-2 border-t border-border pt-3"><Button type="button" variant="outline" onClick={onClose}>{t.cancel}</Button><Button type="submit" disabled={!canSave} aria-busy={busy}>{busy?t.saving:t.save}</Button></div>
  </form>
 </DialogContent></Dialog>;
}
