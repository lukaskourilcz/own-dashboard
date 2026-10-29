'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {qk} from '@/lib/queries/keys';
import {awaitWithSignal} from '@/lib/abortable';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {createCareerSavedRecord,updateCareerSavedRecord,applyCareerSavedReceipt,CareerSavedError,type CareerSavedFields,type CareerSavedPatch} from '@/lib/career-saved-records';
import {normalizeJobUrl} from '@/lib/jobs/enrich';
import type {SavedJobPosition,Updater} from '@/lib/types';

type Form={letter:string;notes:string;readiness:NonNullable<SavedJobPosition['readiness']>};
type Attempt={kind:'create';id:string;fields:CareerSavedFields}|{kind:'update';source:SavedJobPosition;patch:CareerSavedPatch};
type Failure=Attempt&{reason:'changed'|'invalid'|'unavailable'};
type Operation=CareerScope&{stop:AbortController};
const seed=(row:Pick<SavedJobPosition,'cover_letter'|'notes'|'readiness'>):Form=>({letter:row.cover_letter,notes:row.notes??'',readiness:row.readiness??'draft'});
export function useCareerSavedLetterDraft({userId,initial,defaults,setPositions,disabled=false,onSaved}:{userId:string;initial:SavedJobPosition|null;defaults:CareerSavedFields;setPositions:Updater<SavedJobPosition[]>;disabled?:boolean;onSaved:()=>void}){
 const owner=useOwnerPreferences(),qc=useQueryClient(),db=createClient();
 const [originalOwner]=useState(userId),[originalDefaults]=useState(()=>structuredClone(defaults)),[reviewed,setReviewed]=useState(()=>initial?structuredClone(initial):null);
 const [form,setForm]=useState<Form>(()=>initial?seed(initial):{letter:defaults.cover_letter??'',notes:defaults.notes??'',readiness:defaults.readiness??'draft'}),[baseline,setBaseline]=useState(form);
 const fields=useRef(form),baselineRef=useRef(form),source=useRef(reviewed),dirty=useRef(false),creationId=useRef<string|null>(null),failed=useRef<Failure|null>(null),operation=useRef<Operation|null>(null),lifetime=useRef(new AbortController());
 const [pending,setPending]=useState<'write'|'reload'|null>(null),[failure,setFailure]=useState<Failure|null>(null),[reloadFailed,setReloadFailed]=useState(false);
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>lifetime.current.abort();},[]);
 const changed=form.letter!==baseline.letter||form.notes!==baseline.notes||form.readiness!==baseline.readiness;
 function fail(value:Failure|null){failed.current=value;setFailure(value);setReloadFailed(false);}
 function reserve(kind:'write'|'reload'){
  if(disabled||operation.current||!owner||owner.ownerId!==originalOwner||userId!==originalOwner)return null;
  const original=owner.capture(),stop=new AbortController(),captured={ownerId:original.ownerId,stop,signal:AbortSignal.any([original.signal,lifetime.current.signal,stop.signal])};if(captured.signal.aborted)return null;operation.current=captured;setPending(kind);return captured;
 }
 function release(captured:Operation){if(operation.current!==captured)return;const retired=captured.signal.aborted;operation.current=null;captured.stop.abort();if(!retired)setPending(null);}
 function update(patch:Partial<Form>){if(operation.current||failed.current&&failed.current.reason!=='invalid')return;fields.current={...fields.current,...patch};dirty.current=Object.entries(fields.current).some(([key,value])=>value!==baselineRef.current[key as keyof Form]);setForm(fields.current);fail(null);}
 async function cancelRead(captured:CareerScope){const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);await awaitWithSignal(qc.cancelQueries({queryKey:qk.savedJobPositions,exact:true}),signal);signal.throwIfAborted();}
 function adopt(row:SavedJobPosition){source.current=row;setReviewed(row);baselineRef.current=seed(row);fields.current=baselineRef.current;setBaseline(fields.current);setForm(fields.current);dirty.current=false;creationId.current=null;fail(null);}
 async function perform(attempt:Attempt){
  const captured=reserve('write');if(!captured)return false;const base=qc.getQueryData<SavedJobPosition[]>(qk.savedJobPositions);
  try{
   const receipt=attempt.kind==='create'?await createCareerSavedRecord(db,captured,attempt.id,attempt.fields):await updateCareerSavedRecord(db,captured,attempt.source,attempt.patch);captured.signal.throwIfAborted();await cancelRead(captured);captured.signal.throwIfAborted();
   setPositions(rows=>attempt.kind==='create'?rows!==base||rows.some(row=>row.id===receipt.id||row.url===receipt.url)?rows:[receipt,...rows]:applyCareerSavedReceipt(rows,attempt.source,receipt));
   adopt(receipt);void qc.invalidateQueries({queryKey:qk.savedJobPositions,exact:true,refetchType:'none'});onSaved();return true;
  }catch(error){if(!captured.signal.aborted)fail({...attempt,reason:error instanceof CareerSavedError?error.reason:'unavailable'});return false;}
  finally{release(captured);}
 }
 function save(){
  if(operation.current||failed.current&&failed.current.reason!=='invalid')return Promise.resolve(false);
  const value=fields.current,before=source.current;
  if(before){const previous=baselineRef.current,patch:CareerSavedPatch={};if(value.letter!==previous.letter)patch.cover_letter=value.letter;if(value.notes!==previous.notes)patch.notes=value.notes.trim()||null;if(value.readiness!==previous.readiness)patch.readiness=value.readiness;if(!Object.keys(patch).length)return Promise.resolve(true);return perform({kind:'update',source:structuredClone(before),patch});}
  creationId.current??=crypto.randomUUID();return perform({kind:'create',id:creationId.current,fields:{...originalDefaults,cover_letter:value.letter,notes:value.notes.trim()||null,readiness:value.readiness}});
 }
 async function reload(){
  const captured=reserve('reload');if(!captured)return false;const base=qc.getQueryData<SavedJobPosition[]>(qk.savedJobPositions),id=source.current?.id,url=normalizeJobUrl(originalDefaults.url);
  try{
   const latest=await readCareerRecords(db,'saved_job_positions',captured);captured.signal.throwIfAborted();await cancelRead(captured);captured.signal.throwIfAborted();const row=latest.data.find(row=>id?row.id===id:row.url===url);
   if(!row||qc.getQueryData(qk.savedJobPositions)!==base)throw new CareerSavedError();setPositions(rows=>rows===base?latest.data:rows);adopt(row);return true;
  }catch{if(!captured.signal.aborted)setReloadFailed(true);return false;}
  finally{release(captured);}
 }
 useUnsavedDraft({get dirty(){return dirty.current||failed.current?.reason==='unavailable';},get pending(){return operation.current!==null;},canSave:!disabled&&!failure,save,discard:()=>{dirty.current=false;}});
 return{form,reviewed,pending,failure,reloadFailed,changed,locked:pending!==null||!!failure&&failure.reason!=='invalid',update,save,reload,retry:()=>{const attempt=failed.current;return attempt?.reason==='unavailable'?perform(attempt):Promise.resolve(false);},isPending:()=>operation.current!==null,isDirty:()=>dirty.current,isCurrent:()=>!lifetime.current.signal.aborted&&owner?.ownerId===originalOwner&&!owner.capture().signal.aborted};
}
