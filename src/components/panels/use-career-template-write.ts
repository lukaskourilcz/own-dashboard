'use client';

import {useLayoutEffect,useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {useUnsavedDraft} from '@/components/navigation-guard';
import {useOwnerPreferences} from '@/lib/owner-preferences';
import {createClient} from '@/lib/supabase/client';
import {awaitWithSignal} from '@/lib/abortable';
import {qk} from '@/lib/queries/keys';
import {readCareerRecords,type CareerScope} from '@/lib/career-records';
import {createCareerTemplate,updateCareerTemplate,removeCareerTemplate,applyCareerTemplateReceipt,CareerTemplateError,type CareerTemplateFields,type CareerTemplatePatch} from '@/lib/career-template-records';
import type {CoverLetterTemplate,Updater} from '@/lib/types';

type Attempt={kind:'create';id:string;fields:CareerTemplateFields}|{kind:'update';source:CoverLetterTemplate;fields:CareerTemplatePatch}|{kind:'remove';source:CoverLetterTemplate};
type Failure=Attempt&{reason:'changed'|'invalid'|'unavailable'};
type Operation=CareerScope&{stop:AbortController};
export function useCareerTemplateWrite({userId,setTemplates}:{userId:string;setTemplates:Updater<CoverLetterTemplate[]>}){
 const owner=useOwnerPreferences(),qc=useQueryClient(),db=createClient(),[originalOwner]=useState(userId);
 const lifetime=useRef(new AbortController()),operation=useRef<Operation|null>(null),failed=useRef<Failure|null>(null);
 const [pending,setPending]=useState<'write'|'reload'|null>(null),[failure,setFailure]=useState<Failure|null>(null),[reloadFailed,setReloadFailed]=useState(false);
 useLayoutEffect(()=>{if(lifetime.current.signal.aborted)lifetime.current=new AbortController();return()=>lifetime.current.abort();},[]);
 function fail(value:Failure|null){failed.current=value;setFailure(value);setReloadFailed(false);}
 function reserve(kind:'write'|'reload'){
  if(operation.current||!owner||owner.ownerId!==originalOwner||userId!==originalOwner)return null;
  const original=owner.capture(),stop=new AbortController(),captured={ownerId:original.ownerId,stop,signal:AbortSignal.any([original.signal,lifetime.current.signal,stop.signal])};if(captured.signal.aborted)return null;operation.current=captured;setPending(kind);return captured;
 }
 function release(captured:Operation){if(operation.current!==captured)return;const retired=captured.signal.aborted;operation.current=null;captured.stop.abort();if(!retired)setPending(null);}
 async function cancelRead(captured:CareerScope){const signal=AbortSignal.any([captured.signal,AbortSignal.timeout(5_000)]);await awaitWithSignal(qc.cancelQueries({queryKey:qk.coverLetterTemplates,exact:true}),signal);signal.throwIfAborted();}
 async function perform(attempt:Attempt,reserved?:Operation){
  const captured=reserved??reserve('write');if(!captured)return null;
  try{
   const receipt=attempt.kind==='create'?await createCareerTemplate(db,captured,attempt.id,attempt.fields):attempt.kind==='update'?await updateCareerTemplate(db,captured,attempt.source,attempt.fields):await removeCareerTemplate(db,captured,attempt.source);
   captured.signal.throwIfAborted();await cancelRead(captured);captured.signal.throwIfAborted();
   setTemplates(rows=>attempt.kind==='create'?rows.some(row=>row.id===receipt.id)?rows:[...rows,receipt]:applyCareerTemplateReceipt(rows,attempt.source,attempt.kind==='remove'?null:receipt));
   void qc.invalidateQueries({queryKey:qk.coverLetterTemplates,exact:true,refetchType:'none'});fail(null);return receipt;
  }catch(error){if(!captured.signal.aborted)fail({...attempt,reason:error instanceof CareerTemplateError?error.reason:'unavailable'});return null;}
  finally{release(captured);}
 }
 async function remove(source:CoverLetterTemplate,confirm:()=>Promise<boolean>){
  const captured=reserve('write');if(!captured)return null;const attempt:Attempt={kind:'remove',source:structuredClone(source)};
  try{const accepted=await awaitWithSignal(confirm(),captured.signal);captured.signal.throwIfAborted();return accepted?await perform(attempt,captured):null;}
  catch{if(!captured.signal.aborted)fail({...attempt,reason:'unavailable'});return null;}
  finally{release(captured);}
 }
 async function reload(id?:string){
  const captured=reserve('reload');if(!captured)return null;const base=qc.getQueryData<CoverLetterTemplate[]>(qk.coverLetterTemplates);
  try{
   const latest=await readCareerRecords(db,'cover_letter_templates',captured);captured.signal.throwIfAborted();await cancelRead(captured);captured.signal.throwIfAborted();
   const row=id?latest.data.find(row=>row.id===id):null;if(id&&!row||qc.getQueryData(qk.coverLetterTemplates)!==base)throw new CareerTemplateError();
   setTemplates(rows=>rows===base?latest.data:rows);fail(null);return{row:row??null};
  }catch{if(!captured.signal.aborted)setReloadFailed(true);return null;}
  finally{release(captured);}
 }
 useUnsavedDraft({dirty:false,get pending(){return operation.current!==null;},canSave:false,save:async()=>false});
 return{pending,failure,reloadFailed,remove,reload,create:(id:string,fields:CareerTemplateFields)=>perform({kind:'create',id,fields:structuredClone(fields)}),update:(source:CoverLetterTemplate,fields:CareerTemplatePatch)=>perform({kind:'update',source:structuredClone(source),fields:structuredClone(fields)}),retry:()=>{const attempt=failed.current;return attempt?.reason==='unavailable'?perform(attempt):Promise.resolve(null);},clearFailure:()=>fail(null),isPending:()=>operation.current!==null,isCurrent:()=>!lifetime.current.signal.aborted&&owner?.ownerId===originalOwner&&!owner.capture().signal.aborted};
}
