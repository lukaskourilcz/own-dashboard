"use client";

import { useState } from "react";
import { MessageSquareText, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useDict } from "@/lib/i18n";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { ProjectCommunication, Updater } from "@/lib/types";

type Channel = ProjectCommunication["channel"];
type Direction = ProjectCommunication["direction"];

function defaultOccurredAt() {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

const emptyForm = () => ({ occurredAt: defaultOccurredAt(), channel: "email" as Channel, direction: "outbound" as Direction, contact: "", subject: "", summary: "", nextAction: "" });

export function ProjectCommunicationPanel({ projectId, communications, setCommunications }: { projectId: string; communications: ProjectCommunication[]; setCommunications: Updater<ProjectCommunication[]> }) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const toast = useToast();
  const confirm = useConfirmation();
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.summary.trim()) {
      setError(p.communicationSummaryPlaceholder);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error(t.common.signInFirst);
      const { data, error: insertError } = await supabase.from("project_communications").insert({
        user_id: userId,
        project_id: projectId,
        occurred_at: new Date(form.occurredAt).toISOString(),
        channel: form.channel,
        direction: form.direction,
        contact: form.contact.trim() || null,
        subject: form.subject.trim() || null,
        summary: form.summary.trim(),
        next_action: form.nextAction.trim() || null,
      }).select().single();
      if (insertError || !data) throw insertError ?? new Error("no-data");
      setCommunications((prev) => [data as ProjectCommunication, ...prev]);
      setForm(emptyForm());
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove(item: ProjectCommunication) {
    if (!await confirm({
      title: p.deleteCommunication,
      description: p.deleteCommunicationConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error: deleteError } = await supabase.from("project_communications").delete().eq("id", item.id);
    if (deleteError) return toast.err(deleteError.message);
    setCommunications((prev) => prev.filter((row) => row.id !== item.id));
  }

  const rows = [...communications].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return <div className="grid gap-4 xl:grid-cols-[minmax(17rem,0.75fr)_minmax(0,1.6fr)]">
    <Card><CardHeader><CardTitle>{p.addCommunication}</CardTitle></CardHeader><CardContent><form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5"><Label htmlFor="communication-date">{p.communicationDate}</Label><Input id="communication-date" type="datetime-local" value={form.occurredAt} onChange={(event) => setForm({ ...form, occurredAt: event.target.value })} /></div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2"><div className="space-y-1.5"><Label>{p.communicationChannel}</Label><SimpleSelect value={form.channel} onValueChange={(channel) => setForm({ ...form, channel: channel as Channel })} aria-label={p.communicationChannel} options={(Object.keys(p.communicationChannels) as Channel[]).map((value) => ({ value, label: p.communicationChannels[value] }))} /></div><div className="space-y-1.5"><Label>{p.communicationDirection}</Label><SimpleSelect value={form.direction} onValueChange={(direction) => setForm({ ...form, direction: direction as Direction })} aria-label={p.communicationDirection} options={(Object.keys(p.communicationDirections) as Direction[]).map((value) => ({ value, label: p.communicationDirections[value] }))} /></div></div>
      <div className="space-y-1.5"><Label htmlFor="communication-contact">{p.communicationContact}</Label><Input id="communication-contact" value={form.contact} onChange={(event) => setForm({ ...form, contact: event.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="communication-subject">{p.communicationSubject}</Label><Input id="communication-subject" value={form.subject} onChange={(event) => setForm({ ...form, subject: event.target.value })} /></div>
      <div className="space-y-1.5"><Label htmlFor="communication-summary">{p.communicationSummary}</Label><Textarea id="communication-summary" value={form.summary} onChange={(event) => setForm({ ...form, summary: event.target.value })} placeholder={p.communicationSummaryPlaceholder} rows={5} /></div>
      <div className="space-y-1.5"><Label htmlFor="communication-next">{p.communicationNextAction}</Label><Input id="communication-next" value={form.nextAction} onChange={(event) => setForm({ ...form, nextAction: event.target.value })} placeholder={p.communicationNextActionPlaceholder} /></div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}><Plus />{p.addCommunication}</Button>
    </form></CardContent></Card>
    <Card><CardHeader><CardTitle>{p.communicationHistory}</CardTitle></CardHeader><CardContent>{rows.length === 0 ? <EmptyState icon={MessageSquareText} title={p.communicationHistory} description={p.noRelatedRecords} /> : <ol className="relative border-l border-border pl-5">{rows.map((item) => <li key={item.id} className="relative border-b border-border py-4 first:pt-0 last:border-0"><span className="absolute -left-[1.45rem] top-5 h-2 w-2 rounded-full border border-border-strong bg-surface-elevated" aria-hidden /><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium">{item.subject || p.communicationChannels[item.channel]}</p><p className="mt-1 text-xs text-foreground-muted tabular">{item.occurred_at.slice(0, 16).replace("T", " ")} · {p.communicationChannels[item.channel]} · {p.communicationDirections[item.direction]}{item.contact ? ` · ${item.contact}` : ""}</p></div><Button size="icon-sm" variant="ghost" onClick={() => void remove(item)} aria-label={p.deleteCommunication}><Trash2 /></Button></div><p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{item.summary}</p>{item.next_action && <p className="mt-2 rounded-md border border-warning/25 bg-warning-soft px-2 py-1.5 text-xs"><span className="font-medium">{p.communicationNextAction}:</span> {item.next_action}</p>}</li>)}</ol>}</CardContent></Card>
  </div>;
}
