"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { useDict, useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import type { JobApplication, Updater } from "@/lib/types";

export function CareerProgressDialog({ app, onClose, setApplications }: {
  app: JobApplication; onClose: () => void; setApplications: Updater<JobApplication[]>;
}) {
  const t = useDict();
  const cs = useLang().lang === "cs";
  const qc = useQueryClient();
  const [status, setStatus] = useState(app.status);
  const [response, setResponse] = useState(app.response_kind ?? "none");
  const [date, setDate] = useState(app.responded_on ?? "");
  const [followUp, setFollowUp] = useState(app.next_follow_up_at?.slice(0,10) ?? "");
  const [notes, setNotes] = useState(app.notes ?? "");
  // PostgREST omits a column that does not exist, so the presence of the key is
  // the honest test for whether the contact migration has been applied.
  const contactsAvailable = "contact_name" in app || "contact_email" in app;
  const [contactName, setContactName] = useState(app.contact_name ?? "");
  const [contactEmail, setContactEmail] = useState(app.contact_email ?? "");
  const [contactFailed, setContactFailed] = useState(false);
  const today = new Date().toLocaleDateString("en-CA", {timeZone:"Europe/Prague"});
  const save = useMutation({
    mutationFn: async () => {
      if (response !== "none" && (!date || date < app.applied_on || date > today)) throw new Error("date");
      const supabase = createClient();
      const { data, error } = await supabase.rpc("update_job_application_progress", {
        p_id: app.id, p_status: status, p_responded_on: response === "none" ? null : date,
        p_response_kind: response === "none" ? null : response,
        p_follow_up_at: followUp ? `${followUp}T09:00:00Z` : null, p_notes: notes,
      });
      if (error || !data) throw error ?? new Error("no-data");
      const row = data as JobApplication;
      // The progress RPC is a whole-row update of the stage/response columns and
      // knows nothing about contacts, so the contact pair is a second, own-only
      // write guarded by the same RLS policies. It runs only when it changed.
      const changed = contactName.trim() !== (app.contact_name ?? "") || contactEmail.trim() !== (app.contact_email ?? "");
      if (!contactsAvailable || !changed) return { row, contactFailed: false };
      const { data: withContact, error: contactError } = await supabase.from("job_applications")
        .update({ contact_name: contactName.trim() || null, contact_email: contactEmail.trim() || null, updated_at: new Date().toISOString() })
        .eq("id", app.id).select().single();
      if (contactError || !withContact) return { row, contactFailed: true };
      return { row: withContact as JobApplication, contactFailed: false };
    },
    onSuccess: ({ row, contactFailed: failed }) => {
      setApplications(old => old.map(item => item.id === row.id ? row : item));
      void qc.invalidateQueries({queryKey:qk.jobApplications});
      void qc.invalidateQueries({queryKey:qk.jobApplicationEvents});
      setContactFailed(failed);
      if (!failed) onClose();
    },
  });
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent className="max-w-xl">
    <DialogTitle>{cs ? "Odpověď a další postup" : "Response and follow-up"}</DialogTitle>
    <p className="text-sm text-foreground-muted break-words">{app.company} · {app.title}</p>
    <form className="mt-3 space-y-4" onSubmit={event => {event.preventDefault();save.mutate();}}>
      <div className="space-y-1.5"><Label>{cs ? "Stav přihlášky" : "Application status"}</Label><SimpleSelect value={status} onValueChange={value=>setStatus(value as JobApplication["status"])} aria-label={cs ? "Stav přihlášky" : "Application status"} options={[
        {value:"applied",label:cs?"Odesláno":"Applied"},{value:"interviewing",label:cs?"Pohovory":"Interviewing"},
        {value:"offer",label:cs?"Nabídka":"Offer"},{value:"rejected",label:cs?"Zamítnuto":"Rejected"},{value:"withdrawn",label:cs?"Staženo":"Withdrawn"},
      ]}/></div>
      <div className="space-y-1.5"><Label>{cs ? "První skutečná odpověď" : "First substantive response"}</Label><SimpleSelect value={response} onValueChange={setResponse} aria-label={cs ? "První skutečná odpověď" : "First substantive response"} options={[
        {value:"none",label:cs?"Bez odpovědi":"No response"},{value:"positive",label:cs?"Zájem / pozvání":"Interest / invitation"},
        {value:"negative",label:cs?"Zamítnutí":"Rejection"},{value:"neutral",label:cs?"Dotaz / jiná odpověď":"Question / other response"},
      ]}/><p className="text-sm text-foreground-muted">{cs?"Automatické potvrzení přijetí CV sem nepočítejte.":"Do not count an automated acknowledgement of your CV."}</p></div>
      {response !== "none" && <div className="space-y-1.5"><Label htmlFor="response-date">{cs?"Datum první odpovědi":"First response date"}</Label><Input id="response-date" type="date" min={app.applied_on} max={today} required value={date} onChange={event=>setDate(event.target.value)}/></div>}
      <div className="space-y-1.5"><Label htmlFor="follow-up-date">{cs?"Kdy se připomenout":"Follow-up date"}</Label><Input id="follow-up-date" type="date" value={followUp} onChange={event=>setFollowUp(event.target.value)}/></div>
      <fieldset className="space-y-1.5"><legend className="text-sm font-medium">{t.jobs.contactLabel}</legend>
        {contactsAvailable ? <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="contact-name">{t.jobs.contactName}</Label><Input id="contact-name" maxLength={200} value={contactName} onChange={event=>setContactName(event.target.value)}/></div>
          <div className="space-y-1.5"><Label htmlFor="contact-email">{t.jobs.contactEmail}</Label><Input id="contact-email" type="email" maxLength={200} value={contactEmail} onChange={event=>setContactEmail(event.target.value)}/></div>
        </div> : <p className="text-sm text-foreground-muted">{t.jobs.contactMigrationPending}</p>}
      </fieldset>
      <div className="space-y-1.5"><Label htmlFor="progress-notes">{cs?"Poznámky a další krok":"Notes and next step"}</Label><Textarea id="progress-notes" value={notes} onChange={event=>setNotes(event.target.value)} rows={4}/></div>
      {contactFailed && <p role="alert" className="text-sm text-destructive">{t.jobs.contactSaveFailed}</p>}
      {save.isError && <p role="alert" className="text-sm text-destructive">{cs?"Změny se nepodařilo uložit. Zkontrolujte data a zkuste to znovu.":"Could not save changes. Check the dates and try again."}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{cs?"Zrušit":"Cancel"}</Button><Button disabled={save.isPending}>{save.isPending?(cs?"Ukládám…":"Saving…"):(cs?"Uložit":"Save")}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
