"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Inbox, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { AppNotification, ClientOpportunity, ImportantDate, InboxItem, InboxStatus, JobApplication, Note, Organization, Project, Todo, Transaction, Updater } from "@/lib/types";

type Destination = "task" | "note" | "opportunity" | "project" | "organization" | "job_application" | "important_date" | "transaction_category";

function slugify(value: string): string {
  return value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "project";
}

function payloadId(item: InboxItem, key: string): string | null {
  const value = item.payload[key];
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value) ? value : null;
}

export function InboxPanel({ items, setItems, notifications, setNotifications }: { items: InboxItem[]; setItems: Updater<InboxItem[]>; notifications: AppNotification[]; setNotifications: Updater<AppNotification[]> }) {
  const t = useDict();
  const p = t.professional;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const [capture, setCapture] = useState("");
  const [filter, setFilter] = useState<InboxStatus>("pending");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [destinationFilter, setDestinationFilter] = useState("all");
  const [destinations, setDestinations] = useState<Record<string, Destination>>({});

  const captureMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const { data, error } = await supabase.from("inbox_items").insert({ user_id: userId, source_type: "manual", title: capture.trim(), suggested_destination: "task" }).select().single();
      if (error) throw error;
      return data as InboxItem;
    },
    onSuccess: (item) => { setItems((old) => [item, ...old]); setCapture(""); void qc.invalidateQueries({ queryKey: qk.inboxItems }); },
    onError: () => toast.err(p.couldNotSave),
  });

  const statusMutation = useMutation({
    mutationFn: async ({ id, status, snoozedUntil }: { id: string; status: InboxStatus; snoozedUntil?: string | null }) => {
      const { data, error } = await supabase.from("inbox_items").update({ status, processed_at: status === "processed" ? new Date().toISOString() : null, snoozed_until: snoozedUntil ?? null, updated_at: new Date().toISOString() }).eq("id", id).select().single();
      if (error) throw error;
      return data as InboxItem;
    },
    onSuccess: (item) => { setItems((old) => old.map((x) => x.id === item.id ? item : x)); void qc.invalidateQueries({ queryKey: qk.inboxItems }); },
    onError: () => toast.err(p.couldNotSave),
  });

  const processMutation = useMutation({
    mutationFn: async ({ item, destination }: { item: InboxItem; destination: Destination }) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("Not authenticated");
      const project_id = payloadId(item, "project_id");
      const organization_id = payloadId(item, "organization_id");
      const opportunity_id = payloadId(item, "opportunity_id");
      const job_application_id = payloadId(item, "job_application_id");
      if (destination === "task") {
        const { data, error } = await supabase.from("todos").insert({ user_id: userId, title: item.title, source: "manual", project_id, organization_id, opportunity_id, job_application_id }).select().single();
        if (error) throw error;
        qc.setQueryData<Todo[]>(qk.todos, (old = []) => [data as Todo, ...old]);
      } else if (destination === "note") {
        const { data, error } = await supabase.from("notes").insert({ user_id: userId, title: item.title, content: [], plain_text: item.summary ?? item.title, tags: ["inbox"], project_id, organization_id, opportunity_id, job_application_id }).select().single();
        if (error) throw error;
        qc.setQueryData<Note[]>(qk.notes, (old = []) => [data as Note, ...old]);
      } else if (destination === "opportunity") {
        const { data, error } = await supabase.from("client_opportunities").insert({ user_id: userId, title: item.title, description: item.summary ?? "", source: "other", project_id, organization_id }).select().single();
        if (error) throw error;
        qc.setQueryData<ClientOpportunity[]>(qk.opportunities, (old = []) => [data as ClientOpportunity, ...old]);
      } else if (destination === "project") {
        const { data, error } = await supabase.from("projects").insert({ user_id: userId, name: item.title, slug: `${slugify(item.title)}-${item.id.slice(0, 6)}`, summary: item.summary ?? "", sort_order: 0 }).select().single();
        if (error) throw error;
        qc.setQueryData<Project[]>(qk.projects, (old = []) => [...old, data as Project]);
      } else if (destination === "organization") {
        const { data, error } = await supabase.from("organizations").insert({ user_id: userId, name: item.title, type: "prospective_client", notes: item.summary ?? "" }).select().single();
        if (error) throw error;
        qc.setQueryData<Organization[]>(qk.organizations, (old = []) => [data as Organization, ...old]);
      } else if (destination === "job_application") {
        const company = typeof item.payload.company === "string" ? item.payload.company : null;
        const { data, error } = await supabase.from("job_applications").insert({ user_id: userId, title: item.title, company, notes: item.summary, organization_id }).select().single();
        if (error) throw error;
        qc.setQueryData<JobApplication[]>(qk.jobApplications, (old = []) => [data as JobApplication, ...old]);
      } else if (destination === "important_date") {
        const candidate = typeof item.payload.date === "string" ? item.payload.date : "";
        const theDate = /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : new Date().toISOString().slice(0, 10);
        const { data, error } = await supabase.from("important_dates").insert({ user_id: userId, title: item.title, the_date: theDate, notes: item.summary, is_recurring: false, project_id, organization_id }).select().single();
        if (error) throw error;
        qc.setQueryData<ImportantDate[]>(qk.importantDates, (old = []) => [data as ImportantDate, ...old]);
      } else if (destination === "transaction_category") {
        const category = typeof item.payload.category === "string" ? item.payload.category.trim() : "";
        if (item.source_type !== "transaction" || !item.source_id || !category) throw new Error("invalid destination");
        const { data, error } = await supabase.from("transactions").update({ category }).eq("id", item.source_id).select().single();
        if (error) throw error;
        qc.setQueryData<Transaction[]>(qk.transactions, (old = []) => old.map((transaction) => transaction.id === data.id ? data as Transaction : transaction));
      }
      const { data, error } = await supabase.from("inbox_items").update({ status: "processed", processed_at: new Date().toISOString(), suggested_destination: destination, updated_at: new Date().toISOString() }).eq("id", item.id).select().single();
      if (error) throw error;
      return data as InboxItem;
    },
    onSuccess: (item) => { setItems((old) => old.map((x) => x.id === item.id ? item : x)); void qc.invalidateQueries({ queryKey: qk.inboxItems }); },
    onError: (error) => toast.err(error instanceof Error && error.message === "invalid destination" ? p.invalidDestination : p.couldNotSave),
  });

  const bulkDismissMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      if (ids.length === 0) return [];
      const { error } = await supabase.from("inbox_items").update({ status: "dismissed", snoozed_until: null, updated_at: new Date().toISOString() }).in("id", ids);
      if (error) throw error;
      return ids;
    },
    onSuccess: (ids) => setItems((old) => old.map((item) => ids.includes(item.id) ? { ...item, status: "dismissed", snoozed_until: null } : item)),
    onError: () => toast.err(p.couldNotSave),
  });

  const readMutation = useMutation({
    mutationFn: async (id: string) => {
      const read_at = new Date().toISOString();
      const { error } = await supabase.from("notifications").update({ read_at }).eq("id", id);
      if (error) throw error;
      return { id, read_at };
    },
    onSuccess: ({ id, read_at }) => {
      setNotifications((old) => old.map((item) => item.id === id ? { ...item, read_at } : item));
      void qc.invalidateQueries({ queryKey: qk.notifications });
    },
    onError: () => toast.err(p.couldNotSave),
  });

  const sources = [...new Set(items.map((item) => item.source_type))].sort();
  const destinationOptions: { value: Destination; label: string }[] = [
    { value: "task", label: p.task }, { value: "note", label: p.note }, { value: "opportunity", label: p.opportunity },
    { value: "project", label: p.project }, { value: "organization", label: p.client }, { value: "job_application", label: p.jobApplication },
    { value: "important_date", label: p.importantDate }, { value: "transaction_category", label: p.transactionCategory },
  ];
  const query = search.trim().toLocaleLowerCase();
  const visible = items.filter((item) =>
    item.status === filter &&
    (sourceFilter === "all" || item.source_type === sourceFilter) &&
    (destinationFilter === "all" || item.suggested_destination === destinationFilter) &&
    (!query || `${item.title} ${item.summary ?? ""}`.toLocaleLowerCase().includes(query)),
  );
  return <div>
    <PageHeader title={p.inboxTitle} description={p.inboxDescription} />
    <Card className="mb-4"><CardContent className="p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{p.notificationsTitle}</p>{notifications.filter((item) => !item.read_at && !item.dismissed_at).length === 0 ? <p className="text-sm text-foreground-muted">{p.notificationsEmpty}</p> : <div className="space-y-2">{notifications.filter((item) => !item.read_at && !item.dismissed_at).slice(0, 5).map((item) => <div key={item.id} className="flex items-start gap-3 rounded-lg border border-border p-3"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.title}</p>{item.body && <p className="mt-1 text-xs text-foreground-muted">{item.body}</p>}</div><Button variant="ghost" size="sm" onClick={() => readMutation.mutate(item.id)}>{p.markRead}</Button></div>)}</div>}</CardContent></Card>
    <form className="mb-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (capture.trim()) captureMutation.mutate(); }}><Input value={capture} onChange={(event) => setCapture(event.target.value)} placeholder={p.capturePlaceholder} /><Button type="submit" disabled={!capture.trim() || captureMutation.isPending}><Plus />{p.capture}</Button></form>
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label={p.searchInbox} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={p.searchInbox} /><SimpleSelect aria-label={p.status} value={filter} onValueChange={(value) => setFilter(value as InboxStatus)} options={(["pending", "processed", "snoozed", "dismissed"] as InboxStatus[]).map((status) => ({ value: status, label: p[status] }))} /><SimpleSelect aria-label={p.allSources} value={sourceFilter} onValueChange={setSourceFilter} options={[{ value: "all", label: p.allSources }, ...sources.map((source) => ({ value: source, label: source }))]} /><SimpleSelect aria-label={p.allDestinations} value={destinationFilter} onValueChange={setDestinationFilter} options={[{ value: "all", label: p.allDestinations }, ...destinationOptions]} /></div>
    {visible.length > 1 && filter !== "dismissed" && <Button className="mb-4" size="sm" variant="outline" onClick={() => bulkDismissMutation.mutate(visible.map((item) => item.id))} disabled={bulkDismissMutation.isPending}>{p.bulkDismiss}</Button>}
    {visible.length === 0 ? <EmptyState title={p.inboxEmpty} icon={Inbox} /> : <div className="space-y-3">{visible.map((item) => {
      const destination = destinations[item.id] ?? (item.suggested_destination as Destination | null) ?? "task";
      return <Card key={item.id}><CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><p className="font-medium">{item.title}</p>{item.summary && <p className="mt-1 text-xs text-foreground-muted">{item.summary}</p>}<p className="mt-1 text-[10px] uppercase text-foreground-subtle">{item.source_type}</p>{typeof item.payload.action_url === "string" && <a className="mt-2 inline-flex items-center gap-1 text-xs underline" href={item.payload.action_url}><ExternalLink className="h-3 w-3" />{p.openSource}</a>}</div>
        {item.status === "pending" ? <><div className="w-full sm:w-44"><SimpleSelect aria-label={`${p.process}: ${item.title}`} value={destination} onValueChange={(value) => setDestinations((old) => ({ ...old, [item.id]: value as Destination }))} options={destinationOptions} /></div><Button size="sm" onClick={() => processMutation.mutate({ item, destination })}>{p.process}</Button><Button size="sm" variant="outline" onClick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); statusMutation.mutate({ id: item.id, status: "snoozed", snoozedUntil: tomorrow.toISOString() }); }}>{p.snooze}</Button><Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: item.id, status: "dismissed" })}>{p.dismiss}</Button></> : <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: item.id, status: "pending" })}>{p.restore}</Button>}
      </CardContent></Card>;
    })}</div>}
  </div>;
}
