'use client';

import {useLayoutEffect,useMemo,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {formatDistanceToNow} from 'date-fns';
import {Bookmark,ExternalLink,FileText,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {EmptyState} from '@/components/ui/empty-state';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {useConfirmation} from '@/components/ui/confirmation-dialog';
import {useToast} from '@/components/ui/toast';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useDateLocale,useDict,useLang} from '@/lib/i18n';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {qk} from '@/lib/queries/keys';
import {awaitWithSignal} from '@/lib/abortable';
import {collectionPage} from '@/lib/collection-page';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {applyCareerSavedReceipt,createCareerSavedRecord,removeCareerSavedRecord,CareerSavedError,type CareerSavedFields} from '@/lib/career-saved-records';
import {normalizeJobUrl} from '@/lib/jobs/enrich';
import {enrichCareerUrl} from '@/lib/jobs/enrich-client';
import {isGoogleLetterUrl,readinessLabel} from '@/lib/jobs/pipeline';
import {safeWebUrl} from '@/lib/web-url';
import type {SavedJobPosition,Updater} from '@/lib/types';
import {CareerPagination} from './career-pagination';
import {CareerActionNotice} from './career-action-notice';

type Form={url:string;title:string;company:string;location:string;description:string};
const empty=():Form=>({url:'',title:'',company:'',location:'',description:''});
type Attempt={kind:'create';ownerId:string;id:string;fields:CareerSavedFields}|{kind:'remove';ownerId:string;source:SavedJobPosition};
type Failure={kind:'write';attempt:Attempt;reason:'changed'|'unavailable'|'invalid'}|{kind:'import'}|{kind:'reload'};

export function SavedPositionsView({readyOnly,positions,setPositions,userId,onPrepare,onReveal}:{readyOnly:boolean;positions:SavedJobPosition[];setPositions:Updater<SavedJobPosition[]>;userId:string;onPrepare:(position:SavedJobPosition)=>void;onReveal:(id:string)=>void}){
 const t=useDict(),{lang}=useLang(),cs=lang==='cs',locale=useDateLocale(),toast=useToast(),owner=useOwnerPreferences(),confirm=useConfirmation(),qc=useQueryClient(),db=createClient();
 const [form,setForm]=useState(empty),fields=useRef(form),dirty=useRef(false),creationId=useRef<string|null>(null);
 const [draftOwner]=useState(userId);
 const [showFields,setShowFields]=useState(false),[search,setSearch]=useState(''),[pageIndex,setPageIndex]=useState(0),[pending,setPending]=useState<'write'|'import'|'reload'|null>(null),[failure,setFailure]=useState<Failure|null>(null);
 const lifetime=useRef(new AbortController()),operation=useRef<CareerScope|null>(null),urlControl=useRef<HTMLInputElement|null>(null),searchControl=useRef<HTMLInputElement|null>(null),activity=useRef(0);
 const importStop=useRef<AbortController|null>(null);
 const focusAfter=useRef<{epoch:number;target:string|null;removed?:string}|null>(null),root=useRef<HTMLDivElement|null>(null);
 const restoreControl=useRef<{element:HTMLElement;epoch:number}|null>(null);
 // The QueryClient itself belongs to this owner; use the shell's canonical key.
 const queryKey=qk.savedJobPositions;
 const visible=useMemo(()=>{const query=search.toLocaleLowerCase();return positions.filter(row=>`${row.company} ${row.title}`.toLocaleLowerCase().includes(query));},[positions,search]),page=collectionPage(visible,pageIndex);
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>lifetime.current.abort();},[]);
 useLayoutEffect(()=>{
  const control=restoreControl.current;
  if(control&&!pending&&!operation.current){restoreControl.current=null;if(control.epoch===activity.current&&control.element.isConnected)control.element.focus();}
  const intent=focusAfter.current;if(!intent||pending||operation.current)return;
  if(intent.epoch!==activity.current){focusAfter.current=null;return;}
  if(intent.removed&&positions.some(row=>row.id===intent.removed))return;
  const target=intent.target?root.current?.querySelector<HTMLElement>(`[data-career-position="${intent.target}"] [data-career-saved-title]`):null;
  if(intent.target&&!target)return;
  focusAfter.current=null;(target??searchControl.current)?.focus();
 },[positions,pending]);
 function update(patch:Partial<Form>){
  if(operation.current&&!importStop.current)return;
  if(importStop.current&&patch.url!==undefined&&patch.url!==fields.current.url){
   importStop.current.abort();importStop.current=null;operation.current=null;setPending(null);
  }
  const next={...fields.current,...patch};fields.current=next;dirty.current=Object.values(next).some(value=>value.trim()!=='');setForm(next);setFailure(null);
 }
 function reset(){if(operation.current)return;fields.current=empty();dirty.current=false;creationId.current=null;setForm(fields.current);setShowFields(false);setFailure(null);urlControl.current?.focus();}
 function reserve(kind:NonNullable<typeof pending>){
  if(operation.current||!owner||userId!==draftOwner)return null;const original=owner.capture();if(original.ownerId!==draftOwner)return null;
  const cancellation=kind==='import'?new AbortController():null;
  const captured={ownerId:original.ownerId,signal:AbortSignal.any([original.signal,lifetime.current.signal,...(cancellation?[cancellation.signal]:[])])};if(captured.signal.aborted)return null;importStop.current=cancellation;operation.current=captured;setPending(kind);return captured;
 }
 function release(captured:CareerScope){if(operation.current!==captured)return;const retired=captured.signal.aborted;operation.current=null;importStop.current?.abort();importStop.current=null;if(!retired)setPending(null);}
 async function cancelOlderRead(captured:CareerScope){const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);await awaitWithSignal(qc.cancelQueries({queryKey,exact:true}),signal);signal.throwIfAborted();}
 async function perform(attempt:Attempt,alreadyReserved?:CareerScope):Promise<boolean>{
  const captured=alreadyReserved??reserve('write');if(!captured)return false;
  if(attempt.ownerId!==captured.ownerId){release(captured);return false;}
  const epoch=activity.current,base=qc.getQueryData<SavedJobPosition[]>(queryKey);
  try{
   const receipt=attempt.kind==='create'?await createCareerSavedRecord(db,captured,attempt.id,attempt.fields):await removeCareerSavedRecord(db,captured,attempt.source);
   captured.signal.throwIfAborted();await cancelOlderRead(captured);captured.signal.throwIfAborted();
   if(attempt.kind==='create'){
    setPositions(current=>current!==base||current.some(row=>row.id===receipt.id||row.url===receipt.url)?current:[receipt,...current]);
    onReveal(receipt.id);fields.current=empty();dirty.current=false;creationId.current=null;setForm(fields.current);setShowFields(false);
    if(activity.current===epoch){setSearch('');setPageIndex(0);focusAfter.current={epoch,target:receipt.id};}
    toast.ok(t.jobs.positionSaved);
   }else{
    const index=visible.findIndex(row=>row.id===attempt.source.id),neighbor=visible[index+1]??visible[index-1];
    setPositions(current=>applyCareerSavedReceipt(current,attempt.source,null));
    if(activity.current===epoch){setPageIndex(Math.floor(Math.max(0,index===visible.length-1?index-1:index)/50));focusAfter.current={epoch,target:neighbor?.id??null,removed:attempt.source.id};}
   }
   setFailure(null);void qc.invalidateQueries({queryKey,exact:true,refetchType:'none'});return true;
  }catch(error){if(!captured.signal.aborted)setFailure({kind:'write',attempt,reason:error instanceof CareerSavedError?error.reason:'unavailable'});return false;}
  finally{release(captured);}
 }
 async function save():Promise<boolean>{
  if(operation.current)return false;const form={...fields.current},url=normalizeJobUrl(form.url);if(!url||!form.title.trim()){setShowFields(true);return false;}
  const id=creationId.current??crypto.randomUUID();creationId.current=id;
  return perform({kind:'create',ownerId:draftOwner,id,fields:{title:form.title.trim(),url,company:form.company.trim()||null,location:form.location.trim()||null,description:form.description.trim()||null,source:'manual'}});
 }
 async function remove(source:SavedJobPosition,control:HTMLButtonElement){
  const captured=reserve('write');if(!captured)return;const attempt:Attempt={kind:'remove',ownerId:draftOwner,source:structuredClone(source)},epoch=activity.current;
  restoreControl.current={element:control,epoch};
  try{
   const accepted=await awaitWithSignal(confirm({title:cs?'Odebrat uloženou pozici?':'Remove saved position?',description:source.title,confirmLabel:t.common.delete,cancelLabel:t.common.cancel,destructive:true}),captured.signal);
   captured.signal.throwIfAborted();if(!accepted){release(captured);if(activity.current===epoch)control.focus();return;}
   if(await perform(attempt,captured))restoreControl.current=null;
  }catch{release(captured);}
 }
 async function importUrl(){
  const captured=reserve('import');if(!captured)return;const baseline={...fields.current};setShowFields(true);setFailure(null);
  try{
   const result=await enrichCareerUrl(captured,baseline.url);captured.signal.throwIfAborted();
   if(normalizeJobUrl(fields.current.url)!==result.inputUrl)return;
   const next={...fields.current,url:result.url};for(const key of ['title','company','description'] as const)if(next[key]===baseline[key])next[key]=result[key];
   fields.current=next;dirty.current=true;setForm(next);
  }catch{if(!captured.signal.aborted)setFailure({kind:'import'});}
  finally{release(captured);}
 }
 async function reload(){
  const captured=reserve('reload');if(!captured)return;const base=qc.getQueryData<SavedJobPosition[]>(queryKey),epoch=activity.current;
  try{
   const result=await readCareerRecords(db,'saved_job_positions',captured);captured.signal.throwIfAborted();await cancelOlderRead(captured);captured.signal.throwIfAborted();
   if(qc.getQueryData(queryKey)!==base)throw new CareerSavedError();
   setPositions(current=>current===base?result.data:current);const match=result.data.find(row=>row.url===normalizeJobUrl(fields.current.url));if(match)onReveal(match.id);
   setFailure(null);if(activity.current===epoch){setSearch('');setPageIndex(0);searchControl.current?.focus();}
  }catch{if(!captured.signal.aborted)setFailure({kind:'reload'});}
  finally{release(captured);}
 }
 useUnsavedDraft({get dirty(){return dirty.current;},get pending(){return operation.current!==null;},canSave:!!form.title.trim()&&!!normalizeJobUrl(form.url),save,discard:reset});
 const message=failure?.kind==='write'?failure.reason==='changed'?(cs?'Pozice se změnila nebo už existuje. Údaje zůstaly zachované. Načtěte uložené pozice.':'The position changed or already exists. Your details are kept. Reload saved positions.'):failure.reason==='invalid'?(cs?'Zkontrolujte délku údajů a platnost odkazů.':'Check field lengths and links.'):failure.attempt.kind==='create'?t.jobs.couldNotSave:t.jobs.couldNotDelete:failure?.kind==='import'?t.jobs.urlImportFailed:failure?.kind==='reload'?(cs?'Uložené pozice se nepodařilo načíst. Zkuste to znovu.':'Saved positions could not be loaded. Try again.'):null;
 const locked=pending==='write'||pending==='reload';
 return <div ref={root} data-career-saved className="mx-auto w-full max-w-3xl space-y-4" onPointerDownCapture={()=>{activity.current++;}} onKeyDownCapture={()=>{activity.current++;}}>
  {!readyOnly&&<Card className="space-y-3 p-4">
   <div><h2 className="text-base font-semibold">{t.jobs.saveByUrl}</h2><p className="mt-1 text-sm text-foreground-muted">{t.jobs.saveByUrlDescription}</p></div>
   <div className="flex flex-col gap-2 sm:flex-row"><Input ref={urlControl} type="url" value={form.url} disabled={locked} onChange={event=>update({url:event.target.value})} placeholder="https://…" aria-label={t.jobs.link}/><Button type="button" variant="outline" onClick={()=>void importUrl()} disabled={!normalizeJobUrl(form.url)||pending!==null}>{pending==='import'?t.jobs.importing:t.jobs.importFromUrl}</Button>{!showFields&&<Button type="button" variant="ghost" onClick={()=>setShowFields(true)} disabled={pending!==null}>{cs?'Vyplnit ručně':'Enter manually'}</Button>}</div>
   {showFields&&<div className="space-y-3 border-t border-border pt-3">
    <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="saved-job-title">{t.jobs.position}</Label><Input id="saved-job-title" value={form.title} readOnly={locked} onChange={event=>update({title:event.target.value})}/></div><div className="space-y-1.5"><Label htmlFor="saved-job-company">{t.jobs.company}</Label><Input id="saved-job-company" value={form.company} readOnly={locked} onChange={event=>update({company:event.target.value})}/></div></div>
    <div className="space-y-1.5"><Label htmlFor="saved-job-location">{cs?'Lokalita':'Location'}</Label><Input id="saved-job-location" value={form.location} readOnly={locked} onChange={event=>update({location:event.target.value})}/></div>
    <div className="space-y-1.5"><Label htmlFor="saved-job-description">{cs?'Popis pozice':'Job description'}</Label><Textarea id="saved-job-description" rows={3} value={form.description} readOnly={locked} onChange={event=>update({description:event.target.value})}/></div>
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={reset} disabled={pending!==null}>{cs?'Vymazat koncept':'Clear draft'}</Button><Button type="button" onClick={()=>void save()} disabled={!normalizeJobUrl(form.url)||!form.title.trim()||pending!==null} aria-busy={pending==='write'}><Bookmark className="h-4 w-4"/>{t.jobs.savePosition}</Button></div>
   </div>}
  </Card>}
  {message&&<CareerActionNotice message={message}><div className="flex flex-wrap gap-2">
   {failure?.kind==='write'&&failure.reason==='unavailable'&&<Button type="button" variant="outline" disabled={pending!==null} onClick={()=>void perform(failure.attempt)}>{cs?'Zkusit znovu':'Try again'}</Button>}
   {(failure?.kind==='reload'||failure?.kind==='write')&&<Button type="button" variant="outline" disabled={pending!==null} onClick={()=>void reload()}>{cs?'Načíst uložené pozice':'Reload saved positions'}</Button>}
  </div></CareerActionNotice>}
  <Input ref={searchControl} value={search} onChange={event=>{setSearch(event.target.value);setPageIndex(0);}} aria-label={cs?'Hledat uložené pozice':'Search saved positions'} placeholder={cs?'Firma nebo pozice':'Company or position'} className="max-w-sm"/>
  <CareerPagination page={page} onPage={setPageIndex} label={t.jobs.savedPages}/>
  {visible.length===0?<EmptyState icon={Bookmark} title={t.jobs.noSavedPositions} description={t.jobs.noSavedPositionsDescription} className="py-16"/>:<div className="divide-y divide-border rounded-md border border-border bg-surface">{page.items.map(position=>{const link=safeWebUrl(position.url,2048);return <article key={position.id} data-career-position={position.id} className="flex flex-col gap-3 p-4">
   <div className="min-w-0 flex-1"><>{link?<a data-career-saved-title href={link} target="_blank" rel="noopener noreferrer" className="break-words text-base font-semibold hover:underline focus-ring rounded-sm">{position.title}</a>:<span data-career-saved-title tabIndex={-1} className="break-words text-base font-semibold focus-ring">{position.title}</span>}</><p className="mt-1 text-sm text-foreground-muted">{[position.company,position.location].filter(Boolean).join(' · ')}</p><p className="mt-1 text-sm text-foreground-muted">{readinessLabel(position.readiness,cs)}</p>{position.notes&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-foreground-muted">{position.notes}</p>}<p className="mt-1 text-xs text-foreground-subtle">{cs?'Uloženo':'Saved'} {formatDistanceToNow(new Date(position.saved_at),{addSuffix:true,locale})}</p></div>
   <div className="flex flex-wrap gap-2">{link&&<Button asChild variant="outline" size="sm"><a href={link} target="_blank" rel="noopener noreferrer">{cs?'Inzerát':'Job posting'}<ExternalLink className="h-4 w-4"/></a></Button>}{position.cover_letter_url&&isGoogleLetterUrl(position.cover_letter_url)&&<Button asChild variant="outline" size="sm"><a href={position.cover_letter_url} target="_blank" rel="noopener noreferrer">{cs?'Dopis na Google Drive':'Cover letter on Google Drive'}<ExternalLink className="h-4 w-4"/></a></Button>}<Button variant="ghost" size="sm" disabled={pending!==null} onClick={event=>void remove(position,event.currentTarget)} aria-label={cs?'Odebrat uloženou pozici':'Remove saved position'}><Trash2 className="h-4 w-4"/></Button><Button size="sm" disabled={pending!==null} onClick={()=>onPrepare(position)}><FileText className="h-4 w-4"/>{readyOnly?(cs?'Zkontrolovat / označit odeslání':'Review / mark as sent'):t.jobs.prepareApplication}</Button></div>
  </article>;})}</div>}
 </div>;
}
