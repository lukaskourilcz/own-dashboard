'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {awaitWithSignal} from '@/lib/abortable';
import {qk} from '@/lib/queries/keys';
import {databaseVersion} from '@/lib/database-version';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {progressCareerApplication,applyCareerProgressReceipt,applyCareerProgressEvents,CareerProgressError,type CareerProgressPatch} from '@/lib/career-application-progress';
import type {JobApplication,JobApplicationEvent,Updater} from '@/lib/types';

type Attempt={source:JobApplication;patch:CareerProgressPatch};
type Failure=Attempt&{reason:'changed'|'invalid'|'unavailable'};
type Operation=CareerScope&{stop:AbortController};
/** Shared by the stage controls and response editor. The QueryClient belongs
 * to this original owner; confirmed writes use canonical keys without refetch. */
export function useCareerProgressWrite({userId,setApplications,setEvents}:{userId:string;setApplications:Updater<JobApplication[]>;setEvents:Updater<JobApplicationEvent[]>}){
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
 async function cancelReads(captured:CareerScope){const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);await awaitWithSignal(Promise.all([qk.jobApplications,qk.jobApplicationEvents].map(queryKey=>qc.cancelQueries({queryKey,exact:true}))),signal);signal.throwIfAborted();}
 async function perform(source:JobApplication,patch:CareerProgressPatch){
  const captured=reserve('write');if(!captured)return null;const attempt={source:structuredClone(source),patch:structuredClone(patch)},base=qc.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents);
  try{
   const receipt=await progressCareerApplication(db,captured,attempt.source,attempt.patch);captured.signal.throwIfAborted();await cancelReads(captured);captured.signal.throwIfAborted();
   const current=qc.getQueryData<JobApplication[]>(qk.jobApplications),canApply=current&&(applyCareerProgressReceipt(current,attempt.source,receipt)!==current||current.some(row=>row.id===receipt.row.id&&row.user_id===receipt.ownerId&&databaseVersion(row.updated_at)===databaseVersion(receipt.row.updated_at)));
   setApplications(rows=>applyCareerProgressReceipt(rows,attempt.source,receipt));
   if(base&&canApply)setEvents(rows=>applyCareerProgressEvents(rows,base,receipt));
   for(const queryKey of [qk.jobApplications,qk.jobApplicationEvents])void qc.invalidateQueries({queryKey,exact:true,refetchType:'none'});
   fail(null);return receipt;
  }catch(error){if(!captured.signal.aborted)fail({...attempt,reason:error instanceof CareerProgressError?error.reason:'unavailable'});return null;}
  finally{release(captured);}
 }
 async function reload(id:string){
  const captured=reserve('reload');if(!captured)return null;const applications=qc.getQueryData<JobApplication[]>(qk.jobApplications),events=qc.getQueryData<JobApplicationEvent[]>(qk.jobApplicationEvents);
  try{
   const [latest,history]=await Promise.all([readCareerRecords(db,'job_applications',captured),readCareerRecords(db,'job_application_events',captured)]);captured.signal.throwIfAborted();await cancelReads(captured);captured.signal.throwIfAborted();
   const row=latest.data.find(row=>row.id===id);if(!row||qc.getQueryData(qk.jobApplications)!==applications||qc.getQueryData(qk.jobApplicationEvents)!==events)throw new CareerProgressError();
   setApplications(current=>current===applications?latest.data:current);setEvents(current=>current===events?history.data:current);fail(null);return row;
  }catch{if(!captured.signal.aborted)setReloadFailed(true);return null;}
  finally{release(captured);}
 }
 useUnsavedDraft({dirty:false,get pending(){return operation.current!==null;},canSave:false,save:async()=>false});
 return{pending,failure,reloadFailed,perform,reload,retry:()=>{const attempt=failed.current;return attempt?.reason==='unavailable'?perform(attempt.source,attempt.patch):Promise.resolve(null);},clearFailure:()=>fail(null),isPending:()=>operation.current!==null,isCurrent:()=>!lifetime.current.signal.aborted&&owner?.ownerId===originalOwner&&!owner.capture().signal.aborted};
}
