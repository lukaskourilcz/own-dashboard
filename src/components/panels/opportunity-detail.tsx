"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SimpleSelect } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { useLang } from "@/lib/i18n";
import { statusLabel } from "@/lib/status-presentation";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { httpsUrl, PREVIEW_PLATFORMS } from "@/lib/freelance";
import type { ClientOpportunity, OpportunityStatus } from "@/lib/types";
import { useFreelancePlatforms } from "./freelance-platforms";

const statuses: OpportunityStatus[] = ["discovered","shortlisted","contacted","proposal_sent","negotiating","won","lost","expired","archived"];
type OpportunityEvent = { id: string; status: OpportunityStatus; previous_status: OpportunityStatus | null; submitted_on: string | null; responded_on: string | null; created_at: string };

export function OpportunityDetail({ item, userId, isPreview, onClose, onSaved }: {
  item: ClientOpportunity; userId: string; isPreview: boolean; onClose: () => void; onSaved: (item: ClientOpportunity) => void;
}) {
  const { lang } = useLang(); const cs = lang === "cs"; const toast = useToast(); const qc = useQueryClient();
  const [form, setForm] = useState({ ...item });
  const platforms = useFreelancePlatforms(userId, isPreview);
  const rows = isPreview ? PREVIEW_PLATFORMS : platforms.data ?? [];
  const history = useQuery({ queryKey: [...qk.opportunityEvents,userId,item.id], enabled: !isPreview, queryFn: async ({ signal }) => {
    const { data,error } = await createClient().from("opportunity_events").select("id,status,previous_status,submitted_on,responded_on,created_at").eq("user_id",userId).eq("opportunity_id",item.id).order("created_at",{ascending:false}).limit(100).abortSignal(signal);
    if(error) throw error; return data as OpportunityEvent[];
  }});
  const save = useMutation({ mutationFn: async () => {
    if(isPreview) throw new Error("preview");
    const now = new Date().toISOString();
    const { data,error } = await createClient().from("client_opportunities").update({
      title: form.title.trim(), description: form.description, platform_id: form.platform_id || null,
      source_url: form.source_url || null, remote_scope: form.remote_scope ?? "unknown", eligibility: form.eligibility ?? "needs_review",
      stack: (form.stack ?? []).map(x => x.trim()).filter(Boolean), match_notes: form.match_notes ?? "", proposal_text: form.proposal_text ?? "",
      proposal_url: form.proposal_url || null, submitted_on: form.submitted_on || null, responded_on: form.responded_on || null,
      checked_on: form.checked_on || null, notes: form.notes, status: form.status,
      budget_min: form.budget_min, budget_max: form.budget_max, currency: form.currency, rate_type: form.rate_type,
      deadline: form.deadline || null, next_follow_up_at: form.next_follow_up_at || null,
      won_at: form.status === "won" ? (item.won_at ?? now) : null, lost_at: form.status === "lost" ? (item.lost_at ?? now) : null, updated_at: now,
    }).eq("id",item.id).eq("user_id",userId).select().single();
    if(error) throw error; return data as ClientOpportunity;
  }, onSuccess: updated => { onSaved(updated); void qc.invalidateQueries({queryKey:qk.opportunities}); void qc.invalidateQueries({queryKey:[...qk.opportunityEvents,userId,item.id]}); onClose(); },
  onError: () => toast.err(cs ? "Zakázku se nepodařilo uložit; ověřte také, zda už nemáte stejný odkaz na této platformě." : "Could not save the project; check whether this platform already has the same source URL.") });
  const today = new Date().toISOString().slice(0,10);
  const valid = form.title.trim() && (!form.source_url || httpsUrl(form.source_url)) && (!form.proposal_url || httpsUrl(form.proposal_url))
    && (!form.responded_on || (form.submitted_on && form.responded_on >= form.submitted_on && form.responded_on <= today))
    && (!form.submitted_on || form.submitted_on <= today) && (!form.checked_on || form.checked_on <= today)
    && (form.budget_min == null || form.budget_min >= 0) && (form.budget_max == null || form.budget_max >= (form.budget_min ?? 0))
    && /^[A-Z]{3}$/.test(form.currency);
  const scopes = cs ? {worldwide:"Odkudkoliv",europe:"Evropa",czechia:"Česko",restricted:"Omezené země",unknown:"Nutno ověřit",onsite:"Na místě"} : {worldwide:"Worldwide",europe:"Europe",czechia:"Czechia",restricted:"Country restrictions",unknown:"To verify",onsite:"Onsite"};
  const fit = cs ? {verified:"Shoda ověřena",needs_review:"K prověření",not_suitable:"Nevhodná"} : {verified:"Fit verified",needs_review:"Needs review",not_suitable:"Not suitable"};
  const rates = cs ? {unknown:"Neuvedeno",fixed:"Celá zakázka",hourly:"Za hodinu",daily:"Za den",monthly:"Za měsíc"} : {unknown:"Unspecified",fixed:"Fixed project",hourly:"Hourly",daily:"Daily",monthly:"Monthly"};
  return <Dialog open onOpenChange={open => { if(!open) onClose(); }}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
    <DialogHeader><DialogTitle>{item.title}</DialogTitle><DialogDescription>{cs ? "Připravte odpověď a po jejím odeslání na platformě vyplňte skutečné datum; statistiky počítají pouze záznamy s datem odeslání." : "Prepare a proposal and record the actual date after sending it on the platform; statistics count records with a submission date."}</DialogDescription></DialogHeader>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-title">{cs ? "Název zakázky" : "Project title"}</Label><Input id="od-title" value={form.title} onChange={e => setForm({...form,title:e.target.value})}/></div>
      <SimpleSelect aria-label={cs ? "Platforma" : "Platform"} value={form.platform_id ?? ""} onValueChange={value => setForm({...form,platform_id:value || null})} options={[{value:"",label:cs ? "Bez platformy" : "No platform"},...rows.map(row=>({value:row.id,label:row.name}))]} />
      <SimpleSelect aria-label={cs ? "Stav zakázky" : "Project status"} value={form.status} onValueChange={value => setForm({...form,status:value as OpportunityStatus})} options={statuses.map(value=>({value,label:statusLabel(value,lang)}))}/>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-url">{cs ? "Odkaz na poptávku" : "Source URL"}</Label><Input id="od-url" type="url" value={form.source_url ?? ""} onChange={e=>setForm({...form,source_url:e.target.value})}/></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-description">{cs ? "Popis a požadavky" : "Description and requirements"}</Label><Textarea id="od-description" rows={4} value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
      <SimpleSelect aria-label={cs ? "Odkud lze pracovat" : "Remote eligibility"} value={form.remote_scope ?? "unknown"} onValueChange={value => setForm({...form,remote_scope:value as ClientOpportunity['remote_scope']})} options={Object.entries(scopes).map(([value,label])=>({value,label}))}/>
      <SimpleSelect aria-label={cs ? "Vhodnost zakázky" : "Project fit"} value={form.eligibility ?? "needs_review"} onValueChange={value => setForm({...form,eligibility:value as ClientOpportunity['eligibility']})} options={Object.entries(fit).map(([value,label])=>({value,label}))}/>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-stack">{cs ? "Požadované technologie, oddělené čárkou" : "Required technologies, comma separated"}</Label><Input id="od-stack" value={(form.stack ?? []).join(",")} onChange={e=>setForm({...form,stack:e.target.value.split(",")})}/></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-match">{cs ? "Shoda zkušeností a co ještě ověřit" : "Matching experience and questions to resolve"}</Label><Textarea id="od-match" rows={3} value={form.match_notes ?? ""} onChange={e=>setForm({...form,match_notes:e.target.value})}/></div>
      {([['budget_min',cs ? 'Rozpočet od' : 'Budget from'],['budget_max',cs ? 'Rozpočet do' : 'Budget to']] as const).map(([key,label])=><div key={key} className="space-y-1.5"><Label htmlFor={`od-${key}`}>{label}</Label><Input id={`od-${key}`} type="number" min="0" value={form[key] ?? ""} onChange={e=>setForm({...form,[key]:e.target.value === "" ? null : Number(e.target.value)})}/></div>)}
      <div className="space-y-1.5"><Label htmlFor="od-currency">{cs ? "Měna" : "Currency"}</Label><Input id="od-currency" maxLength={3} value={form.currency} onChange={e=>setForm({...form,currency:e.target.value.toUpperCase()})}/></div>
      <SimpleSelect aria-label={cs ? "Typ rozpočtu" : "Rate type"} value={form.rate_type ?? "unknown"} onValueChange={value=>setForm({...form,rate_type:value as ClientOpportunity['rate_type']})} options={Object.entries(rates).map(([value,label])=>({value,label}))}/>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-proposal">{cs ? "Návrh odpovědi klientovi" : "Proposal draft"}</Label><Textarea id="od-proposal" rows={12} value={form.proposal_text ?? ""} onChange={e=>setForm({...form,proposal_text:e.target.value})}/><Button variant="outline" size="sm" onClick={async()=>{try{await navigator.clipboard.writeText(form.proposal_text ?? "");toast.ok(cs ? "Zkopírováno" : "Copied");}catch{toast.err(cs ? "Text zkopírujte ručně." : "Please copy the text manually.");}}}>{cs ? "Kopírovat odpověď" : "Copy proposal"}</Button></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-document">{cs ? "Odkaz na dokument nebo odeslanou nabídku" : "Document or submitted proposal URL"}</Label><Input id="od-document" type="url" value={form.proposal_url ?? ""} onChange={e=>setForm({...form,proposal_url:e.target.value})}/>{httpsUrl(form.proposal_url) && <a className="focus-ring inline-flex min-h-11 items-center text-sm underline" href={httpsUrl(form.proposal_url)} target="_blank" rel="noreferrer">{cs ? "Otevřít dokument" : "Open document"}</a>}</div>
      {([['submitted_on',cs ? 'Skutečně odesláno dne' : 'Actually submitted on'],['responded_on',cs ? 'První odpověď klienta dne' : 'First client reply on'],['checked_on',cs ? 'Nabídka ověřena dne' : 'Posting checked on'],['deadline',cs ? 'Termín zakázky' : 'Project deadline']] as const).map(([key,label])=><div key={key} className="space-y-1.5"><Label htmlFor={`od-${key}`}>{label}</Label><Input id={`od-${key}`} type="date" max={key === 'deadline' ? undefined : today} value={form[key] ?? ""} onChange={e=>setForm({...form,[key]:e.target.value || null})}/></div>)}
      <div className="space-y-1.5"><Label htmlFor="od-followup">{cs ? "Připomenout dne" : "Follow up on"}</Label><Input id="od-followup" type="date" value={form.next_follow_up_at?.slice(0,10) ?? ""} onChange={e=>setForm({...form,next_follow_up_at:e.target.value ? `${e.target.value}T09:00:00.000Z` : null})}/></div>
      <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="od-notes">{cs ? "Poznámky a odpověď klienta" : "Notes and client response"}</Label><Textarea id="od-notes" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/></div>
    </div>
    {!valid && <p role="alert" className="text-sm text-danger">{cs ? "Ověřte název, HTTPS odkazy, rozpočet, měnu a pořadí dat; odpověď vyžaduje datum odeslání a nesmí mu předcházet." : "Check the title, HTTPS URLs, budget, currency and dates; a reply needs a submission date and cannot precede it."}</p>}
    <section className="space-y-2 border-t border-border pt-3"><h3 className="text-sm font-semibold">{cs ? "Historie změn" : "Change history"}</h3>{history.isError && <Button variant="outline" onClick={()=>history.refetch()}>{cs ? "Načíst historii znovu" : "Retry history"}</Button>}{!isPreview && history.isPending && <p role="status" className="text-xs">{cs ? "Načítám historii…" : "Loading history…"}</p>}{history.data?.map(event=><p key={event.id} className="text-xs text-foreground-muted">{new Date(event.created_at).toLocaleString(lang)} · {event.previous_status ? `${statusLabel(event.previous_status,lang)} → ` : ""}{statusLabel(event.status,lang)}{event.submitted_on ? ` · ${cs ? 'Odesláno' : 'Submitted'}: ${event.submitted_on}` : ""}{event.responded_on ? ` · ${cs ? 'Odpověď' : 'Reply'}: ${event.responded_on}` : ""}</p>)}</section>
    <DialogFooter><Button variant="outline" onClick={onClose}>{cs ? "Zavřít" : "Close"}</Button><Button disabled={!valid || save.isPending || isPreview} onClick={()=>save.mutate()}>{cs ? "Uložit zakázku" : "Save project"}</Button></DialogFooter>
  </DialogContent></Dialog>;
}
