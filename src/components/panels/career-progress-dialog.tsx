"use client";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import type { JobApplication, Updater } from "@/lib/types";

export function CareerProgressDialog({ app, onClose, setApplications }: {
  app: JobApplication; onClose: () => void; setApplications: Updater<JobApplication[]>;
}) {
  const cs = useLang().lang === "cs";
  const qc = useQueryClient();
  const [status, setStatus] = useState(app.status);
  const [response, setResponse] = useState(app.response_kind ?? "none");
  const [date, setDate] = useState(app.responded_on ?? "");
  const [followUp, setFollowUp] = useState(app.next_follow_up_at?.slice(0,10) ?? "");
  const [notes, setNotes] = useState(app.notes ?? "");
  const today = new Date().toLocaleDateString("en-CA", {timeZone:"Europe/Prague"});
  const save = useMutation({
    mutationFn: async () => {
      if (response !== "none" && (!date || date < app.applied_on || date > today)) throw new Error("date");
      const { data, error } = await createClient().rpc("update_job_application_progress", {
        p_id: app.id, p_status: status, p_responded_on: response === "none" ? null : date,
        p_response_kind: response === "none" ? null : response,
        p_follow_up_at: followUp ? `${followUp}T09:00:00Z` : null, p_notes: notes,
      });
      if (error || !data) throw error ?? new Error("no-data");
      return data as JobApplication;
    },
    onSuccess: row => {
      setApplications(old => old.map(item => item.id === row.id ? row : item));
      void qc.invalidateQueries({queryKey:qk.jobApplications});
      void qc.invalidateQueries({queryKey:qk.jobApplicationEvents});
      onClose();
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
      <div className="space-y-1.5"><Label htmlFor="progress-notes">{cs?"Poznámky, kontakt a další krok":"Notes, contact and next step"}</Label><Textarea id="progress-notes" value={notes} onChange={event=>setNotes(event.target.value)} rows={4}/></div>
      {save.isError && <p role="alert" className="text-sm text-destructive">{cs?"Změny se nepodařilo uložit. Zkontrolujte data a zkuste to znovu.":"Could not save changes. Check the dates and try again."}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={onClose}>{cs?"Zrušit":"Cancel"}</Button><Button disabled={save.isPending}>{save.isPending?(cs?"Ukládám…":"Saving…"):(cs?"Uložit":"Save")}</Button></div>
    </form>
  </DialogContent></Dialog>;
}
