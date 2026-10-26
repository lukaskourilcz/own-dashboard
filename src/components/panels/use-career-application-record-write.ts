'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {awaitWithSignal} from '@/lib/abortable';
import {qk} from '@/lib/queries/keys';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {updateCareerApplicationLetter,removeCareerApplicationRecord,applyCareerApplicationRecord} from '@/lib/career-application-records';
import {CareerApplicationError} from '@/lib/career-application-save';
import type {JobApplication,JobApplicationEvent,Updater} from '@/lib/types';

type Attempt={kind:'letter';source:JobApplication;letter:string}|{kind:'remove';source:JobApplication};
type Failure=Attempt&{reason:'changed'|'invalid'|'unavailable'};
type Operation=CareerScope&{stop:AbortController};
export function useCareerApplicationRecordWrite({userId,setApplications,setEvents}:{userId:string;setApplications:Updater<JobApplication[]>;setEvents:Updater<JobApplicationEvent[]>}){
 const owner=useOwnerPreferences(),qc=useQueryClient(),db=createClient(),[originalOwner]=useState(userId);
 const operation=useRef<Operation|null>(null),lifetime=useRef(new AbortController()),failed=useRef<Failure|null>(null);
 const [pending,setPending]=useState<'write'|'reload'|null>(null),[failure,setFailure]=useState<Failure|null>(null),[reloadFailed,setReloadFailed]=useState(false);
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>lifetime.current.abort();},[]);
 function fail(value:Failure|null){failed.current=value;setFailure(value);setReloadFailed(false);}
 function reserve(kind:'write'|'reload'){
  if(operation.current||!owner||owner.ownerId!==originalOwner||userId!==originalOwner)return null;
  const original=owner.capture(),stop=new AbortController(),captured={ownerId:original.ownerId,stop,signal:AbortSignal.any([original.signal,lifetime.current.signal,stop.signal])};if(captured.signal.aborted)return null;operation.current=captured;setPending(kind);return captured;
 }
 function release(captured:Operation){if(operation.current!==captured)return;const retired=captured.signal.aborted;operation.current=null;captured.stop.abort();if(!retired)setPending(null);}
 async function cancelReads(captured:CareerScope,history:boolean){const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);await awaitWithSignal(Promise.all([qk.jobApplications,...(history?[qk.jobApplicationEvents]:[])].map(queryKey=>qc.cancelQueries({queryKey,exact:true}))),signal);signal.throwIfAborted();}
 async function perform(attempt:Attempt,reserved?:Operation){
  const captured=reserved??reserve('write');if(!captured)return null;const events=qc.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents);
  try{
   const receipt=attempt.kind==='letter'?await updateCareerApplicationLetter(db,captured,attempt.source,attempt.letter):await removeCareerApplicationRecord(db,captured,attempt.source);
   captured.signal.throwIfAborted();await cancelReads(captured,attempt.kind==='remove');captured.signal.throwIfAborted();
   const current=qc.getQueryData<JobApplication[]>(qk.jobApplications),canRemove=attempt.kind==='remove'&&current&&applyCareerApplicationRecord(current,attempt.source,null)!==current;
   setApplications(rows=>applyCareerApplicationRecord(rows,attempt.source,attempt.kind==='remove'?null:receipt));
   if(attempt.kind==='remove'&&events&&canRemove)setEvents(rows=>rows===events?rows.filter(row=>row.application_id!==attempt.source.id||row.user_id!==captured.ownerId):rows);
   for(const queryKey of [qk.jobApplications,...(attempt.kind==='remove'?[qk.jobApplicationEvents]:[])])void qc.invalidateQueries({queryKey,exact:true,refetchType:'none'});
   fail(null);return receipt;
  }catch(error){if(!captured.signal.aborted)fail({...attempt,reason:error instanceof CareerApplicationError?error.reason:'unavailable'});return null;}
  finally{release(captured);}
 }
 async function remove(source:JobApplication,confirm:()=>Promise<boolean>){
  const captured=reserve('write');if(!captured)return null;const attempt:Attempt={kind:'remove',source:structuredClone(source)};
  try{const accepted=await awaitWithSignal(confirm(),captured.signal);captured.signal.throwIfAborted();return accepted?await perform(attempt,captured):null;}
  catch{if(!captured.signal.aborted)fail({...attempt,reason:'unavailable'});return null;}
  finally{release(captured);}
 }
 async function reload(id?:string){
  const captured=reserve('reload');if(!captured)return null;const applications=qc.getQueryData<JobApplication[]>(qk.jobApplications),events=qc.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents);
  try{
   const [latest,history]=await Promise.all([readCareerRecords(db,'job_applications',captured),readCareerRecords(db,'job_application_events',captured)]);captured.signal.throwIfAborted();await cancelReads(captured,true);captured.signal.throwIfAborted();
   const row=id?latest.data.find(row=>row.id===id):null;if(id&&!row||qc.getQueryData(qk.jobApplications)!==applications||qc.getQueryData(qk.jobApplicationEvents)!==events)throw new CareerApplicationError();
   setApplications(current=>current===applications?latest.data:current);setEvents(current=>current===events?history.data:current);fail(null);return{row:row??null};
  }catch{if(!captured.signal.aborted)setReloadFailed(true);return null;}
  finally{release(captured);}
 }
 useUnsavedDraft({dirty:false,get pending(){return operation.current!==null;},canSave:false,save:async()=>false});
 return{pending,failure,reloadFailed,remove,reload,saveLetter:(source:JobApplication,letter:string)=>perform({kind:'letter',source:structuredClone(source),letter}),retry:()=>{const attempt=failed.current;return attempt?.reason==='unavailable'?perform(attempt):Promise.resolve(null);},clearFailure:()=>fail(null),isPending:()=>operation.current!==null,isCurrent:()=>!lifetime.current.signal.aborted&&owner?.ownerId===originalOwner&&!owner.capture().signal.aborted};
}
