"use client";
import {useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogTitle} from '@/components/ui/dialog';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import {SimpleSelect} from '@/components/ui/select';
import {useGuardedNavigation,useUnsavedDraft} from '@/components/navigation-guard';
import {useDict,useLang} from '@/lib/i18n';
import {useNow} from '@/lib/use-now';
import {focusDayKey} from '@/lib/date-keys';
import type {CareerProgressPatch} from '@/lib/career-application-progress';
import type {JobApplication,JobApplicationEvent,Updater} from '@/lib/types';
import {useCareerProgressWrite} from './use-career-progress-write';
import {CareerActionNotice} from './career-action-notice';

type Form={status:JobApplication['status'];response:NonNullable<JobApplication['response_kind']>|'none';date:string;followUp:string;notes:string;contactName:string;contactEmail:string};
const seed=(app:JobApplication):Form=>({status:app.status,response:app.response_kind??'none',date:app.responded_on??'',followUp:app.next_follow_up_at?.slice(0,10)??'',notes:app.notes??'',contactName:app.contact_name??'',contactEmail:app.contact_email??''});
export function CareerProgressDialog({app,userId,onClose,setApplications,setEvents,timeZone='Europe/Prague'}:{
 app:JobApplication;userId:string;onClose:()=>void;setApplications:Updater<JobApplication[]>;setEvents:Updater<JobApplicationEvent[]>;timeZone?:string;
}){
 const t=useDict(),cs=useLang().lang==='cs',requestExit=useGuardedNavigation(),now=useNow(),today=focusDayKey(now??new Date(),timeZone);
 const [initial]=useState(()=>structuredClone(app)),[reviewed,setReviewed]=useState(initial),source=useRef(initial),[form,setForm]=useState(()=>seed(initial)),fields=useRef(form),baseline=useRef(form),dirty=useRef(false);
 const writer=useCareerProgressWrite({userId,setApplications,setEvents});
 const locked=writer.pending!==null||!!writer.failure&&writer.failure.reason!=='invalid';
 function update(patch:Partial<Form>){if(locked||writer.isPending())return;const next={...fields.current,...patch};fields.current=next;dirty.current=Object.keys(next).some(key=>next[key as keyof Form]!==baseline.current[key as keyof Form]);setForm(next);writer.clearFailure();}
 function patch(){
  const value=fields.current,before=seed(source.current),result:CareerProgressPatch={};
  if(value.status!==before.status)result.status=value.status;
  if(value.response!==before.response||value.date!==before.date){result.response_kind=value.response==='none'?null:value.response;result.responded_on=value.response==='none'?null:value.date;}
  if(value.followUp!==before.followUp)result.next_follow_up_at=value.followUp?`${value.followUp}T09:00:00Z`:null;
  if(value.notes!==before.notes)result.notes=value.notes;
  if(value.contactName!==before.contactName)result.contact_name=value.contactName;
  if(value.contactEmail!==before.contactEmail)result.contact_email=value.contactEmail;
  return result;
 }
 async function save(){const receipt=await writer.perform(source.current,patch());if(!receipt||!writer.isCurrent())return false;dirty.current=false;onClose();return true;}
 async function retry(){const receipt=await writer.retry();if(receipt&&writer.isCurrent()){dirty.current=false;onClose();}}
 async function reload(){const row=await writer.reload(source.current.id);if(!row||!writer.isCurrent())return;source.current=row;setReviewed(row);baseline.current=seed(row);fields.current=baseline.current;dirty.current=false;setForm(fields.current);}
 useUnsavedDraft({get dirty(){return dirty.current;},canSave:!writer.failure,save,discard:()=>{dirty.current=false;}});
 const message=writer.reloadFailed?(cs?'Přihlášku se nepodařilo načíst. Koncept zůstal zachovaný.':'The application could not be loaded. Your draft is kept.')
  :writer.failure?.reason==='changed'?(cs?'Přihláška se změnila. Koncept zůstal zachovaný. Načtěte aktuální přihlášku.':'The application changed. Your draft is kept. Load the current application.')
  :writer.failure?.reason==='invalid'?(cs?'Zkontrolujte data odpovědi, délku údajů a kontaktní e-mail.':'Check the response dates, field lengths and contact email.')
  :writer.failure?(cs?'Uložení není potvrzené. Zkuste znovu stejný požadavek nebo načtěte aktuální přihlášku.':'The save is unconfirmed. Retry the same request or load the current application.'):null;
 function close(){requestExit(onClose);}
 return <Dialog open onOpenChange={open=>{if(!open)close();}}><DialogContent className="max-w-xl" aria-busy={writer.pending!==null}>
  <DialogTitle>{cs?'Odpověď a další postup':'Response and follow-up'}</DialogTitle>
  <p className="text-sm text-foreground-muted break-words">{[reviewed.company,reviewed.title].filter(Boolean).join(' · ')}</p>
  <form className="mt-3 space-y-4" onSubmit={event=>{event.preventDefault();if(!locked)void save();}}>
   <fieldset disabled={writer.pending!==null} className="min-w-0 space-y-4">
    <div className="grid gap-3 sm:grid-cols-2">
     <div className="space-y-1.5"><Label>{cs?'Stav přihlášky':'Application status'}</Label><SimpleSelect disabled={locked} value={form.status} onValueChange={value=>update({status:value as JobApplication['status']})} aria-label={cs?'Stav přihlášky':'Application status'} options={[
      {value:'applied',label:t.jobs.statusApplied},{value:'interviewing',label:t.jobs.statusInterviewing},{value:'offer',label:t.jobs.statusOffer},{value:'rejected',label:t.jobs.statusRejected},{value:'withdrawn',label:t.jobs.statusWithdrawn},
     ]}/></div>
     <div className="space-y-1.5"><Label>{cs?'První skutečná odpověď':'First substantive response'}</Label><SimpleSelect disabled={locked} value={form.response} onValueChange={value=>update({response:value as Form['response']})} aria-label={cs?'První skutečná odpověď':'First substantive response'} options={[
      {value:'none',label:cs?'Bez odpovědi':'No response'},{value:'positive',label:cs?'Zájem / pozvání':'Interest / invitation'},{value:'negative',label:cs?'Zamítnutí':'Rejection'},{value:'neutral',label:cs?'Dotaz / jiná odpověď':'Question / other response'},
     ]}/></div>
    </div>
    <p className="text-sm text-foreground-muted">{cs?'Automatické potvrzení přijetí CV sem nepočítejte.':'Do not count an automated acknowledgement of your CV.'}</p>
    <div className="grid gap-3 sm:grid-cols-2">
     {form.response!=='none'&&<div className="space-y-1.5"><Label htmlFor="response-date">{cs?'Datum první odpovědi':'First response date'}</Label><Input id="response-date" type="date" min={reviewed.applied_on} max={today} required value={form.date} readOnly={locked} onChange={event=>update({date:event.target.value})}/></div>}
     <div className="space-y-1.5"><Label htmlFor="follow-up-date">{cs?'Kdy se připomenout':'Follow-up date'}</Label><Input id="follow-up-date" type="date" value={form.followUp} readOnly={locked} onChange={event=>update({followUp:event.target.value})}/></div>
    </div>
    <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t.jobs.contactLabel}</legend>
     <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-1.5"><Label htmlFor="contact-name">{t.jobs.contactName}</Label><Input id="contact-name" maxLength={200} value={form.contactName} readOnly={locked} onChange={event=>update({contactName:event.target.value})}/></div><div className="space-y-1.5"><Label htmlFor="contact-email">{t.jobs.contactEmail}</Label><Input id="contact-email" type="email" maxLength={200} value={form.contactEmail} readOnly={locked} onChange={event=>update({contactEmail:event.target.value})}/></div></div>
    </fieldset>
    <div className="space-y-1.5"><Label htmlFor="progress-notes">{cs?'Poznámky a další krok':'Notes and next step'}</Label><Textarea id="progress-notes" value={form.notes} readOnly={locked} onChange={event=>update({notes:event.target.value})} rows={3}/></div>
   </fieldset>
   {message&&<CareerActionNotice message={message}><div className="flex flex-wrap gap-2">
    {writer.failure?.reason==='unavailable'&&<Button type="button" variant="outline" disabled={writer.pending!==null} onClick={()=>void retry()}>{cs?'Zkusit znovu':'Try again'}</Button>}
    {writer.failure&&writer.failure.reason!=='invalid'&&<Button type="button" variant="outline" disabled={writer.pending!==null} onClick={()=>void reload()}>{cs?'Zahodit koncept a načíst aktuální':'Discard draft and load latest'}</Button>}
   </div></CareerActionNotice>}
   <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={close}>{cs?'Zrušit':'Cancel'}</Button><Button type="submit" disabled={locked}>{writer.pending?(cs?'Ukládám…':'Saving…'):(cs?'Uložit':'Save')}</Button></div>
  </form>
 </DialogContent></Dialog>;
}
