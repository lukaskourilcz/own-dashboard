'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {awaitWithSignal} from '@/lib/abortable';
import {qk} from '@/lib/queries/keys';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {recordCareerApplication,applyCareerApplicationReceipt,applyCareerApplicationEvent,CareerApplicationError,type CareerApplicationFields} from '@/lib/career-application-save';
import {updateCareerSavedRecord,applyCareerSavedReceipt,CareerSavedError,type CareerSavedPatch} from '@/lib/career-saved-records';
import type {SavedJobPosition,JobApplication,JobApplicationEvent,Updater} from '@/lib/types';

type Form={title:string;company:string;url:string;appliedOn:string;coverLetter:string;coverLetterUrl:string;readiness:NonNullable<SavedJobPosition['readiness']>;notes:string};
type Attempt={kind:'record';source:SavedJobPosition;fields:CareerApplicationFields}|{kind:'draft';source:SavedJobPosition;patch:CareerSavedPatch};
type Failure={reason:'changed'|'unavailable'|'invalid';attempt:Attempt};
function seed(row:SavedJobPosition,day:string):Form{return{title:row.title,company:row.company??'',url:row.url,appliedOn:day,coverLetter:row.cover_letter,coverLetterUrl:row.cover_letter_url??'',readiness:row.readiness??'draft',notes:row.notes??''};}
type Props={source:SavedJobPosition;userId:string;day:string;setSavedPositions:Updater<SavedJobPosition[]>;setApplications:Updater<JobApplication[]>;setEvents:Updater<JobApplicationEvent[]>;onRecorded:()=>void;onDraftSaved:()=>void};

/** Mounted once per dialog opening: background props cannot rebase a private draft. */
export function useCareerApplicationDraft(props:Props){
 const owner=useOwnerPreferences(),qc=useQueryClient(),db=createClient();
 const [draftOwner]=useState(props.userId),[initial]=useState(()=>structuredClone(props.source));
 const [reviewedSource,setReviewedSource]=useState(initial);
 const [form,setForm]=useState(()=>seed(initial,props.day));
 const source=useRef(initial),baseline=useRef(form),fields=useRef(form),dirty=useRef(false);
 const [pending,setPending]=useState<'write'|'reload'|null>(null),[failure,setFailure]=useState<Failure|null>(null),[reloadFailed,setReloadFailed]=useState(false);
 const [recorded,setRecorded]=useState(false),recordedRef=useRef(false);
 const failureRef=useRef<Failure|null>(null),operation=useRef<CareerScope|null>(null),lifetime=useRef(new AbortController());
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>lifetime.current.abort();},[]);
 function fail(value:Failure|null){failureRef.current=value;setFailure(value);setReloadFailed(false);}
 function reserve(kind:'write'|'reload'){
  if(recordedRef.current||operation.current||!owner||owner.ownerId!==draftOwner||props.userId!==draftOwner)return null;
  const original=owner.capture(),captured={ownerId:original.ownerId,signal:AbortSignal.any([original.signal,lifetime.current.signal])};
  if(captured.signal.aborted)return null;operation.current=captured;setPending(kind);return captured;
 }
 function release(captured:CareerScope){if(operation.current!==captured)return;operation.current=null;if(!captured.signal.aborted)setPending(null);}
 async function cancelReads(captured:CareerScope,keys:readonly (readonly string[])[]){
  const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);
  await awaitWithSignal(Promise.all(keys.map(queryKey=>qc.cancelQueries({queryKey,exact:true}))),signal);signal.throwIfAborted();
 }
 function update(patch:Partial<Form>){
  if(recordedRef.current||operation.current||failureRef.current&&failureRef.current.reason!=='invalid')return;
  const next={...fields.current,...patch};fields.current=next;dirty.current=Object.keys(next).some(key=>next[key as keyof Form]!==baseline.current[key as keyof Form]);setForm(next);fail(null);
 }
 async function perform(attempt:Attempt):Promise<boolean>{
  const captured=reserve('write');if(!captured)return false;
  const applications=qc.getQueryData<JobApplication[]>(qk.jobApplications),events=qc.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents);
  try{
   if(attempt.kind==='record'){
    const receipt=await recordCareerApplication(db,captured,attempt.source,attempt.fields);captured.signal.throwIfAborted();
    await cancelReads(captured,[qk.savedJobPositions,qk.jobApplications,qk.jobApplicationEvents]);captured.signal.throwIfAborted();
    props.setSavedPositions(current=>applyCareerSavedReceipt(current,attempt.source,null));
    if(applications)props.setApplications(current=>applyCareerApplicationReceipt(current,applications,receipt));
    if(events)props.setEvents(current=>applyCareerApplicationEvent(current,events,receipt));
    for(const queryKey of [qk.savedJobPositions,qk.jobApplications,qk.jobApplicationEvents])void qc.invalidateQueries({queryKey,exact:true,refetchType:'none'});
    dirty.current=false;fail(null);recordedRef.current=true;setRecorded(true);release(captured);props.onRecorded();
   }else{
    const receipt=await updateCareerSavedRecord(db,captured,attempt.source,attempt.patch);captured.signal.throwIfAborted();
    await cancelReads(captured,[qk.savedJobPositions]);captured.signal.throwIfAborted();
    props.setSavedPositions(current=>applyCareerSavedReceipt(current,attempt.source,receipt));source.current=receipt;setReviewedSource(receipt);
    baseline.current=seed(receipt,fields.current.appliedOn);fields.current=baseline.current;dirty.current=false;setForm(fields.current);fail(null);
    void qc.invalidateQueries({queryKey:qk.savedJobPositions,exact:true,refetchType:'none'});props.onDraftSaved();
   }
   return true;
  }catch(error){if(!captured.signal.aborted)fail({attempt,reason:error instanceof CareerApplicationError||error instanceof CareerSavedError?error.reason:'unavailable'});return false;}
  finally{release(captured);}
 }
 function saveDraft():Promise<boolean>{
  if(recordedRef.current)return Promise.resolve(true);
  if(operation.current||failureRef.current&&failureRef.current.reason!=='invalid')return Promise.resolve(false);
  const value={...fields.current},before=seed(source.current,value.appliedOn),patch:CareerSavedPatch={};
  // Only changed fields enter the new-write bounds; untouched legacy text survives.
  if(value.title!==before.title)patch.title=value.title;
  if(value.company!==before.company)patch.company=value.company.trim()||null;
  if(value.url!==before.url)patch.url=value.url;
  if(value.coverLetter!==before.coverLetter)patch.cover_letter=value.coverLetter;
  if(value.coverLetterUrl!==before.coverLetterUrl)patch.cover_letter_url=value.coverLetterUrl.trim()||null;
  if(value.readiness!==before.readiness)patch.readiness=value.readiness;
  if(value.notes!==before.notes)patch.notes=value.notes.trim()||null;
  if(!Object.keys(patch).length){dirty.current=false;return Promise.resolve(true);}
  return perform({kind:'draft',source:structuredClone(source.current),patch});
 }
 function record(){
  if(operation.current||failureRef.current&&failureRef.current.reason!=='invalid')return;
  const value={...fields.current};void perform({kind:'record',source:structuredClone(source.current),fields:{title:value.title,company:value.company,url:value.url,cover_letter:value.coverLetter,cover_letter_url:value.coverLetterUrl,applied_on:value.appliedOn,notes:value.notes}});
 }
 async function reload(){
  const captured=reserve('reload');if(!captured)return;const base=qc.getQueryData<SavedJobPosition[]>(qk.savedJobPositions);
  try{
   const receipt=await readCareerRecords(db,'saved_job_positions',captured);captured.signal.throwIfAborted();
   await cancelReads(captured,[qk.savedJobPositions]);captured.signal.throwIfAborted();
   if(qc.getQueryData(qk.savedJobPositions)!==base)throw new CareerSavedError();
   const latest=receipt.data.find(row=>row.id===source.current.id);if(!latest)throw new CareerSavedError();
   props.setSavedPositions(current=>current===base?receipt.data:current);
   source.current=latest;setReviewedSource(latest);baseline.current=seed(latest,props.day);fields.current=baseline.current;dirty.current=false;setForm(fields.current);fail(null);
  }catch{if(!captured.signal.aborted)setReloadFailed(true);}
  finally{release(captured);}
 }
 useUnsavedDraft({get dirty(){return dirty.current||failureRef.current?.reason==='unavailable';},get pending(){return operation.current!==null;},canSave:!!form.title.trim()&&!failure,save:saveDraft,discard:()=>{if(!operation.current)dirty.current=false;}});
 return{form,reviewedSource,update,pending,failure,reloadFailed,locked:recorded||pending!==null||!!failure&&failure.reason!=='invalid',saveDraft,record,retry:()=>{const failed=failureRef.current;if(failed?.reason==='unavailable')void perform(failed.attempt);},reload};
}
