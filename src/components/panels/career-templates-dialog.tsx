'use client';

import {useRef,useState} from 'react';
import {Check,Pencil,Plus,Trash2} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {useConfirmation} from '@/components/ui/confirmation-dialog';
import {useToast} from '@/components/ui/toast';
import {useGuardedNavigation,useUnsavedDraft} from '@/components/navigation-guard';
import {CareerPagination} from '@/components/panels/career-pagination';
import {CareerActionNotice} from '@/components/panels/career-action-notice';
import {useCareerTemplateWrite} from '@/components/panels/use-career-template-write';
import {collectionPage} from '@/lib/collection-page';
import {CAREER_TEMPLATE_NAME_MAX,CAREER_TEMPLATE_BODY_MAX} from '@/lib/career-template-records';
import {useDict,useLang} from '@/lib/i18n';
import type {CoverLetterTemplate,Updater} from '@/lib/types';

type Writer=ReturnType<typeof useCareerTemplateWrite>;
export function CareerTemplateFailure({writer,onReload,onRetry}:{writer:Writer;onReload?:()=>void;onRetry?:()=>void}){
 const cs=useLang().lang==='cs';
 const message=writer.reloadFailed?(cs?'Šablony se nepodařilo načíst. Koncept zůstal zachovaný.':'Templates could not be loaded. Your draft is kept.')
  :writer.failure?.reason==='changed'?(cs?'Šablona se změnila nebo už neexistuje. Koncept zůstal zachovaný.':'The template changed or is no longer available. Your draft is kept.')
  :writer.failure?.reason==='invalid'?(cs?'Zadejte název do 150 znaků a neprázdný dopis do 64 000 znaků.':'Enter a name up to 150 characters and a nonempty letter up to 64,000 characters.')
  :writer.failure?(cs?'Uložení není potvrzené. Zkuste znovu stejný požadavek.':'The change is unconfirmed. Retry the same request.'):null;
 if(!message)return null;
 return <CareerActionNotice message={message}><div className="flex flex-wrap gap-2">
  {writer.failure?.reason==='unavailable'&&<Button variant="outline" disabled={writer.pending!==null} onClick={()=>{if(onRetry)onRetry();else void writer.retry();}}>{cs?'Zkusit znovu':'Try again'}</Button>}
  {onReload&&writer.failure&&writer.failure.reason!=='invalid'&&<Button variant="outline" disabled={writer.pending!==null} onClick={onReload}>{cs?'Zahodit koncept a načíst aktuální':'Discard draft and load latest'}</Button>}
 </div></CareerActionNotice>;
}

export function CareerTemplatesDialog({onClose,templates,setTemplates,userId}:{onClose:()=>void;templates:CoverLetterTemplate[];setTemplates:Updater<CoverLetterTemplate[]>;userId:string}){
 const t=useDict(),toast=useToast(),confirm=useConfirmation(),requestExit=useGuardedNavigation();
 const writer=useCareerTemplateWrite({userId,setTemplates}),[editor,setEditor]=useState<{id:string;source:CoverLetterTemplate|null}|null>(null),[pageIndex,setPageIndex]=useState(0),page=collectionPage(templates,pageIndex);
 const locked=writer.pending!==null||!!writer.failure;
 function closeForm(){setEditor(null);writer.clearFailure();}
 async function remove(row:CoverLetterTemplate,control:HTMLButtonElement){
  const receipt=await writer.remove(row,()=>confirm({title:t.jobs.deleteTemplate,description:t.jobs.deleteTemplateConfirm,confirmLabel:t.common.delete,cancelLabel:t.common.cancel,destructive:true}));
  if(!writer.isCurrent())return;if(receipt){toast.ok(t.jobs.templateDeleted);requestAnimationFrame(()=>{if(writer.isCurrent()&&(document.activeElement===document.body||document.activeElement===control||!document.activeElement?.isConnected))document.querySelector<HTMLElement>('[data-career-new-template]')?.focus();});}else if(control.isConnected)control.focus();
 }
 return <Dialog open onOpenChange={open=>{if(!open)requestExit(onClose);}}><DialogContent className="max-w-xl" aria-busy={writer.pending!==null}>
  <div className="flex flex-wrap items-center justify-between gap-3"><DialogTitle>{t.jobs.templatesTitle}</DialogTitle>
   {!editor&&<Button data-career-new-template disabled={locked} onClick={()=>setEditor({id:crypto.randomUUID(),source:null})}><Plus className="h-3.5 w-3.5"/>{t.jobs.newTemplate}</Button>}
  </div>
  {editor?<TemplateEditor key={editor.id} initial={editor.source} id={editor.id} writer={writer} onClose={closeForm}/>:<div className="mt-4 space-y-4">
   <CareerTemplateFailure writer={writer} onReload={()=>void writer.reload()}/>
   {templates.length===0?<p className="py-6 text-center text-sm text-foreground-muted">{t.jobs.noTemplatesYet}</p>:<>
    <ul className="divide-y divide-border rounded-md border border-border">{page.items.map(row=><li key={row.id} className="flex min-w-0 items-center gap-2 px-3 py-2">
     <div className="min-w-0 flex-1"><p className="break-words text-sm font-medium">{row.name.trim()||t.jobs.untitledTemplate}</p><p className="truncate text-xs text-foreground-subtle">{row.body.slice(0,180).replace(/\s+/g,' ').slice(0,90)}</p></div>
     <Button variant="ghost" size="icon" disabled={locked} aria-label={`${t.jobs.editTemplate}: ${row.name.trim()||t.jobs.untitledTemplate}`} onClick={()=>setEditor({id:row.id,source:structuredClone(row)})}><Pencil className="h-3.5 w-3.5"/></Button>
     <Button variant="ghost" size="icon" disabled={locked} aria-label={`${t.jobs.deleteTemplate}: ${row.name.trim()||t.jobs.untitledTemplate}`} onClick={event=>void remove(row,event.currentTarget)}><Trash2 className="h-3.5 w-3.5"/></Button>
    </li>)}</ul>
    <CareerPagination page={page} onPage={setPageIndex} label={t.jobs.templatesTitle}/>
   </>}
   <div className="flex justify-end"><Button variant="ghost" onClick={()=>requestExit(onClose)}>{t.jobs.cancel}</Button></div>
  </div>}
 </DialogContent></Dialog>;
}

function TemplateEditor({initial,id,writer,onClose}:{initial:CoverLetterTemplate|null;id:string;writer:Writer;onClose:()=>void}){
 const t=useDict(),toast=useToast(),requestExit=useGuardedNavigation();
 const source=useRef(initial),[reviewed,setReviewed]=useState(initial),[form,setForm]=useState(()=>({name:initial?.name??'',body:initial?.body??''})),fields=useRef(form),dirty=useRef(false);
 const locked=writer.pending!==null||!!writer.failure&&writer.failure.reason!=='invalid';
 const changed=form.name!==(reviewed?.name??'')||form.body!==(reviewed?.body??'');
 const valid=(form.name===reviewed?.name||!!form.name.trim()&&form.name.trim().length<=CAREER_TEMPLATE_NAME_MAX)&&(form.body===reviewed?.body||!!form.body.trim()&&form.body.length<=CAREER_TEMPLATE_BODY_MAX);
 function update(key:'name'|'body',value:string){if(locked||writer.isPending())return;fields.current={...fields.current,[key]:value};dirty.current=fields.current.name!==(source.current?.name??'')||fields.current.body!==(source.current?.body??'');setForm(fields.current);writer.clearFailure();}
 async function save(){
  if(writer.isPending()||writer.failure)return false;
  const before=source.current,value=fields.current,patch={...(value.name!==before?.name?{name:value.name}:{}),...(value.body!==before?.body?{body:value.body}:{})};
  const receipt=before?await writer.update(before,patch):await writer.create(id,value);
  if(!receipt||!writer.isCurrent())return false;dirty.current=false;toast.ok(t.jobs.templateSaved);onClose();return true;
 }
 async function retry(){const receipt=await writer.retry();if(!receipt||!writer.isCurrent())return;dirty.current=false;toast.ok(t.jobs.templateSaved);onClose();}
 async function reload(){const result=await writer.reload(source.current?.id);if(!result||!writer.isCurrent())return;if(result.row){source.current=result.row;setReviewed(result.row);fields.current={name:result.row.name,body:result.row.body};setForm(fields.current);dirty.current=false;}}
 useUnsavedDraft({get dirty(){return dirty.current||!!writer.failure&&writer.failure.reason!=='invalid';},canSave:!writer.failure&&valid,save,discard:()=>{dirty.current=false;}});
 return <form className="mt-4 space-y-3" onSubmit={event=>{event.preventDefault();void save();}}>
  <div className="space-y-1.5"><Label htmlFor="tpl-name">{t.jobs.templateName}</Label><Input autoFocus id="tpl-name" value={form.name} readOnly={locked} onChange={event=>update('name',event.target.value)} maxLength={CAREER_TEMPLATE_NAME_MAX} placeholder={t.jobs.templateNamePlaceholder}/></div>
  <div className="space-y-1.5"><Label htmlFor="tpl-body">{t.jobs.templateBody}</Label><Textarea id="tpl-body" value={form.body} readOnly={locked} onChange={event=>update('body',event.target.value)} maxLength={CAREER_TEMPLATE_BODY_MAX} rows={6} className="text-base leading-relaxed"/><p className="text-xs text-foreground-subtle">{t.jobs.placeholdersHint}</p></div>
  <CareerTemplateFailure writer={writer} onRetry={()=>void retry()} onReload={reviewed?()=>void reload():undefined}/>
  <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={()=>requestExit(onClose)}>{t.jobs.cancel}</Button><Button type="submit" disabled={locked||!changed||!valid}><Check className="h-3.5 w-3.5"/>{writer.pending?t.jobs.saving:t.jobs.save}</Button></div>
 </form>;
}
