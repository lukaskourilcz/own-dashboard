'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { useUnsavedDraft } from '@/components/navigation-guard';
import { useDict } from '@/lib/i18n';
import { createClient } from '@/lib/supabase/client';
import { qk } from '@/lib/queries/keys';
import { MAX_TASK_MINUTES, TASK_KINDS, type TaskKind } from '@/lib/task-meta';
import { applyTaskWriteReceipt, captureTaskWrite, taskCreateValuesSchema, writeTask } from '@/lib/task-write';
import type { Organization, Project, Todo } from '@/lib/types';

type Fields={title:string;dueDate:string;importance:string;minutes:string;kind:TaskKind|'';projectId:string;organizationId:string;global:boolean};
const empty=():Fields=>({title:'',dueDate:'',importance:'',minutes:'',kind:'',projectId:'',organizationId:'',global:false});
const values=(form:Fields)=>({title:form.title,due_date:form.dueDate||null,importance:form.global?6:form.importance?Number(form.importance):null,estimated_minutes:form.minutes.trim()?Number(form.minutes):null,task_kind:form.kind||null,is_global:form.global,project_id:form.global?null:form.projectId||null,organization_id:form.organizationId||null});

/** Local form state keeps typing out of task grouping; retry identity lasts until explicit discard or confirmation. */
export function TaskComposer({ownerId,projects,organizations,open,onOpenChange,compact=false}:{ownerId:string;projects:Project[];organizations:Organization[];open:boolean;onOpenChange:(open:boolean)=>void;compact?:boolean}){
 const t=useDict(),toast=useToast(),client=useQueryClient(),db=createClient(),id=useId();
 const [draftOwner]=useState(ownerId),[form,setForm]=useState(empty),[pending,setPending]=useState(false),[error,setError]=useState<'save'|'conflict'|'absent'|null>(null);
 const fields=useRef(form),actor=useRef(ownerId),mounted=useRef(false),pendingRef=useRef(false),dirty=useRef(false),blocked=useRef(false),creationId=useRef<string|null>(null),controller=useRef<AbortController|null>(null);
 const current=ownerId===draftOwner,locked=!current||error==='conflict'||error==='absent';
 const valid=taskCreateValuesSchema.safeParse(values(form)).success&&(!form.projectId||projects.some(project=>project.id===form.projectId))&&(!form.organizationId||organizations.some(organization=>organization.id===form.organizationId));
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;controller.current?.abort();};},[]);
 useLayoutEffect(()=>{actor.current=ownerId;if(ownerId!==draftOwner)controller.current?.abort();},[ownerId,draftOwner]);
 function update(patch:Partial<Fields>){
  if(pendingRef.current||blocked.current||actor.current!==draftOwner)return;
  const next={...fields.current,...patch};fields.current=next;dirty.current=Object.values(next).some(value=>value!==''&&value!==false);setForm(next);setError(null);
 }
 function reset(){const next=empty();fields.current=next;dirty.current=false;blocked.current=false;creationId.current=null;setForm(next);setError(null);}
 async function save():Promise<boolean>{
  if(pendingRef.current||blocked.current||actor.current!==draftOwner)return false;
  if((fields.current.projectId&&!projects.some(project=>project.id===fields.current.projectId))||(fields.current.organizationId&&!organizations.some(organization=>organization.id===fields.current.organizationId))){setError('save');return false;}
  let command:ReturnType<typeof captureTaskWrite>;
  try{command=captureTaskWrite({ownerId:draftOwner,id:creationId.current??crypto.randomUUID(),action:'create',expected:null,values:taskCreateValuesSchema.parse(values(fields.current))});}
  catch{setError('save');return false;}
  creationId.current=command.id;pendingRef.current=true;dirty.current=true;setPending(true);setError(null);
  const cancellation=new AbortController();controller.current=cancellation;
  try{
   const result=await writeTask(db,command,cancellation.signal);
   if(!mounted.current||actor.current!==command.ownerId||cancellation.signal.aborted)return false;
   if(result.kind!=='saved'){
    blocked.current=true;setError(result.kind==='absent'?'absent':'conflict');void client.invalidateQueries({queryKey:qk.todos,exact:true});return false;
   }
   await client.cancelQueries({queryKey:qk.todos,exact:true});
   if(!mounted.current||actor.current!==command.ownerId||cancellation.signal.aborted)return false;
   let reconcile=false;
   client.setQueryData<Todo[]>(qk.todos,rows=>{if(!rows){reconcile=true;return rows;}const applied=applyTaskWriteReceipt(rows,command,result);reconcile=applied.reconcile;return applied.rows;});
   if(reconcile)void client.invalidateQueries({queryKey:qk.todos,exact:true});
   void client.invalidateQueries({queryKey:qk.dailyFocus});reset();onOpenChange(false);toast.ok(t.todos.taskAdded);return true;
  }catch{if(mounted.current&&actor.current===command.ownerId&&!cancellation.signal.aborted){setError('save');void client.invalidateQueries({queryKey:qk.todos,exact:true});}return false;}
  finally{if(controller.current===cancellation){controller.current=null;pendingRef.current=false;if(mounted.current)setPending(false);}}
 }
 useUnsavedDraft({get dirty(){return dirty.current;},get pending(){return pendingRef.current;},canSave:current&&!locked&&valid,save,discard:reset});
 const submit=(event:FormEvent)=>{event.preventDefault();void save();};
 const close=()=>{if(!pendingRef.current)onOpenChange(false);};
 const message=!current?t.todos.ownerChanged:error==='save'?t.todos.createErr:error==='conflict'?t.todos.createConflict:error==='absent'?t.todos.createAbsent:null;
 const feedback=message&&<div className="space-y-2" role="alert"><p className="text-sm text-risk">{message}</p>{(locked||error!==null)&&<Button type="button" variant="outline" disabled={pending} onClick={()=>{if(pendingRef.current)return;if(!current){dirty.current=false;window.location.reload();}else reset();}}>{current?t.todos.discardDraft:t.todos.reloadPage}</Button>}</div>;
 const title=<div className="min-w-0 space-y-1.5"><Label className={compact?'sr-only':undefined} htmlFor={`${id}-title`}>{t.todos.taskLabel}</Label><Input id={`${id}-title`} value={form.title} required readOnly={locked} disabled={pending} placeholder={compact?t.todos.quickAddPlaceholder:t.todos.whatNeedsDoing} onChange={event=>update({title:event.target.value})} autoFocus={!compact} aria-invalid={[...form.title.trim()].length>500||undefined} aria-describedby={[...form.title.trim()].length>500?`${id}-title-limit`:undefined}/>{[...form.title.trim()].length>500&&<p id={`${id}-title-limit`} className="text-xs text-risk">{t.todos.titleLimit}</p>}</div>;
 if(compact)return <div className="mb-3 space-y-2"><form className="flex items-start gap-2" onSubmit={submit}><div className="min-w-0 flex-1">{title}</div><Button type="submit" size="icon" disabled={pending||locked||!valid} aria-busy={pending} aria-label={t.todos.addTask}><Plus className="size-4"/></Button></form>{feedback}</div>;
 return <Dialog open={open} onOpenChange={next=>{if(next)onOpenChange(true);else close();}}>
  <DialogContent className="max-w-md" showClose={!pending} aria-describedby={undefined} onEscapeKeyDown={event=>{if(pendingRef.current)event.preventDefault();}} onPointerDownOutside={event=>{if(pendingRef.current)event.preventDefault();}}>
   <DialogHeader><DialogTitle>{t.todos.addTaskTitle}</DialogTitle></DialogHeader>
   <form onSubmit={submit} className="mt-3 space-y-3" aria-busy={pending}>
    {feedback}
    <fieldset disabled={pending} className="min-w-0 space-y-3">
     <legend className="sr-only">{t.todos.addTaskTitle}</legend>
     <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-inset px-3 py-2.5"><div><Label htmlFor={`${id}-global`}>{t.todos.globalTask}</Label><p className="mt-0.5 text-[11px] text-foreground-subtle">{t.todos.globalGroup} · {t.todos.importanceOption(6)}</p></div><Switch id={`${id}-global`} checked={form.global} disabled={pending||locked} onCheckedChange={global=>update({global,importance:global?'6':form.importance==='6'?'':form.importance,...(global?{projectId:''}:{})})}/></div>
     {title}
     <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`${id}-due`}>{t.todos.dueDate}</Label><Input id={`${id}-due`} type="date" value={form.dueDate} readOnly={locked} onChange={event=>update({dueDate:event.target.value})}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-importance`}>{t.todos.importanceLabel}</Label><SimpleSelect id={`${id}-importance`} value={form.importance} disabled={pending||locked||form.global} onValueChange={importance=>update({importance})} options={[{value:'',label:t.todos.importanceNone},...[5,4,3,2,1].map(value=>({value:String(value),label:t.todos.importanceOption(value)}))]}/></div>
     </div>
     <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`${id}-minutes`}>{t.todos.timeLabel}</Label><div className="flex items-center gap-2"><Input id={`${id}-minutes`} type="number" min={1} max={MAX_TASK_MINUTES} step={1} inputMode="numeric" placeholder="30" value={form.minutes} readOnly={locked} onChange={event=>update({minutes:event.target.value})}/><span className="shrink-0 text-xs text-foreground-subtle">{t.todos.timeMinutesUnit}</span></div></div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-kind`}>{t.todos.categoryLabel}</Label><SimpleSelect id={`${id}-kind`} value={form.kind} disabled={pending||locked} onValueChange={kind=>update({kind:kind as Fields['kind']})} options={[{value:'',label:t.todos.categoryNone},...TASK_KINDS.map(value=>({value,label:t.todos.taskKindLabel(value)}))]}/></div>
     </div>
     <div className="grid gap-3 sm:grid-cols-2">
      <div className="space-y-1.5"><Label htmlFor={`${id}-project`}>{t.todos.project}</Label><SimpleSelect id={`${id}-project`} value={form.projectId} disabled={pending||locked||form.global} onValueChange={projectId=>update({projectId})} options={[{value:'',label:t.todos.noProject},...projects.map(project=>({value:project.id,label:project.name})),...(form.projectId&&!projects.some(project=>project.id===form.projectId)?[{value:form.projectId,label:t.todos.selectedUnavailable}]:[])]}/></div>
      <div className="space-y-1.5"><Label htmlFor={`${id}-organization`}>{t.todos.organization}</Label><SimpleSelect id={`${id}-organization`} value={form.organizationId} disabled={pending||locked} onValueChange={organizationId=>update({organizationId})} options={[{value:'',label:t.todos.noOrganization},...organizations.map(organization=>({value:organization.id,label:organization.name})),...(form.organizationId&&!organizations.some(organization=>organization.id===form.organizationId)?[{value:form.organizationId,label:t.todos.selectedUnavailable}]:[])]}/></div>
     </div>
    </fieldset>
    <div className="grid grid-cols-2 gap-2 pt-1"><Button type="button" variant="outline" disabled={pending} onClick={close}>{t.common.cancel}</Button><Button type="submit" disabled={pending||locked||!valid}><Plus className="size-3.5"/>{t.todos.addTask}</Button></div>
   </form>
  </DialogContent>
 </Dialog>;
}
