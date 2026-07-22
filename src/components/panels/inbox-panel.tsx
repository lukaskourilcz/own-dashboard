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
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { useToast } from "@/components/ui/toast";
import { useDict, useLang } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { isActionableNotification, safeNotificationUrl } from "@/lib/notifications";
import { statusLabel } from "@/lib/status-presentation";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { AppNotification, InboxItem, InboxStatus, Updater } from "@/lib/types";

type Destination = "task" | "note" | "opportunity" | "project" | "organization" | "job_application" | "important_date" | "transaction_category";

export function InboxPanel({ items, setItems, notifications, setNotifications }: { items: InboxItem[]; setItems: Updater<InboxItem[]>; notifications: AppNotification[]; setNotifications: Updater<AppNotification[]> }) {
  const t = useDict();
  const { lang } = useLang();
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
      const { data, error } = await supabase.rpc("route_inbox_item", { p_inbox_item_id: item.id, p_destination: destination });
      if (error) throw error;
      const result = data as { inbox_item?: InboxItem } | null;
      if (!result?.inbox_item) throw new Error("invalid destination");
      return result.inbox_item;
    },
    onSuccess: (item) => {
      setItems((old) => old.map((x) => x.id === item.id ? item : x));
      for (const queryKey of [qk.inboxItems, qk.todos, qk.notes, qk.opportunities, qk.projects, qk.organizations, qk.jobApplications, qk.importantDates, qk.transactions]) void qc.invalidateQueries({ queryKey });
    },
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

  const notificationMutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Pick<Partial<AppNotification>, "read_at" | "dismissed_at" | "snoozed_until"> }) => {
      const { data, error } = await supabase.from("notifications").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return data as AppNotification;
    },
    onSuccess: (notification) => {
      setNotifications((old) => old.map((item) => item.id === notification.id ? notification : item));
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
  const actionableNotifications = notifications.filter((item) => isActionableNotification(item));
  return <div>
    <PageHeader title={p.inboxTitle} description={p.inboxDescription} />
    <p className="mb-4 border-l-2 border-information bg-information-soft px-3 py-2 text-xs text-foreground-muted">{p.atomicProcessing}</p>
    <Card className="mb-4"><CardContent className="p-4"><p className="mb-3 text-xs font-semibold uppercase tracking-wider text-foreground-muted">{p.notificationsTitle}</p>{actionableNotifications.length === 0 ? <p className="text-sm text-foreground-muted">{p.notificationsEmpty}</p> : <div className="space-y-2">{actionableNotifications.slice(0, 5).map((item) => { const actionUrl = safeNotificationUrl(item.action_url); return <div key={item.id} className="flex flex-col gap-3 rounded-lg border border-border p-3 sm:flex-row sm:items-start"><div className="min-w-0 flex-1"><p className="text-sm font-medium">{item.title}</p>{item.body && <p className="mt-1 text-xs text-foreground-muted">{item.body}</p>}</div><div className="flex flex-wrap gap-1">{actionUrl && <Button asChild variant="ghost" size="sm"><a href={actionUrl}><ExternalLink />{p.openSource}</a></Button>}<Button variant="ghost" size="sm" onClick={() => notificationMutation.mutate({ id: item.id, patch: { read_at: new Date().toISOString() } })}>{p.markRead}</Button><Button variant="ghost" size="sm" onClick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); notificationMutation.mutate({ id: item.id, patch: { snoozed_until: tomorrow.toISOString() } }); }}>{p.snooze}</Button><Button variant="ghost" size="sm" onClick={() => notificationMutation.mutate({ id: item.id, patch: { dismissed_at: new Date().toISOString() } })}>{p.dismiss}</Button></div></div>; })}</div>}</CardContent></Card>
    <form className="mb-4 flex gap-2" onSubmit={(event) => { event.preventDefault(); if (capture.trim()) captureMutation.mutate(); }}><Input value={capture} onChange={(event) => setCapture(event.target.value)} placeholder={p.capturePlaceholder} /><Button type="submit" disabled={!capture.trim() || captureMutation.isPending}><Plus />{p.capture}</Button></form>
    <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4"><Input aria-label={p.searchInbox} value={search} onChange={(event) => setSearch(event.target.value)} placeholder={p.searchInbox} /><SimpleSelect aria-label={p.status} value={filter} onValueChange={(value) => setFilter(value as InboxStatus)} options={(["pending", "processed", "snoozed", "dismissed"] as InboxStatus[]).map((status) => ({ value: status, label: p[status] }))} /><SimpleSelect aria-label={p.allSources} value={sourceFilter} onValueChange={setSourceFilter} options={[{ value: "all", label: p.allSources }, ...sources.map((source) => ({ value: source, label: statusLabel(source, lang) }))]} /><SimpleSelect aria-label={p.allDestinations} value={destinationFilter} onValueChange={setDestinationFilter} options={[{ value: "all", label: p.allDestinations }, ...destinationOptions]} /></div>
    {visible.length > 1 && filter !== "dismissed" && <Button className="mb-4" size="sm" variant="outline" onClick={() => bulkDismissMutation.mutate(visible.map((item) => item.id))} disabled={bulkDismissMutation.isPending}>{p.bulkDismiss}</Button>}
    {visible.length === 0 ? <EmptyState title={p.inboxEmpty} icon={Inbox} /> : <div className="space-y-3">{visible.map((item) => {
      const destination = destinations[item.id] ?? (item.suggested_destination as Destination | null) ?? "task";
      const actionUrl = typeof item.payload.action_url === "string" ? safeNotificationUrl(item.payload.action_url) : null;
      return <Card key={item.id}><CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{item.title}</p><StatusBadge value={item.status} /><EntityBadge>{statusLabel(item.source_type, lang)}</EntityBadge></div>{item.summary && <p className="mt-1 text-xs text-foreground-muted">{item.summary}</p>}{actionUrl && <a className="mt-2 inline-flex items-center gap-1 text-xs underline" href={actionUrl}><ExternalLink className="h-3 w-3" />{p.openSource}</a>}</div>
        {item.status === "pending" ? <><div className="w-full sm:w-44"><SimpleSelect aria-label={`${p.process}: ${item.title}`} value={destination} onValueChange={(value) => setDestinations((old) => ({ ...old, [item.id]: value as Destination }))} options={destinationOptions} /></div><Button size="sm" onClick={() => processMutation.mutate({ item, destination })}>{p.process}</Button><Button size="sm" variant="outline" onClick={() => { const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); statusMutation.mutate({ id: item.id, status: "snoozed", snoozedUntil: tomorrow.toISOString() }); }}>{p.snooze}</Button><Button size="sm" variant="ghost" onClick={() => statusMutation.mutate({ id: item.id, status: "dismissed" })}>{p.dismiss}</Button></> : <Button size="sm" variant="outline" onClick={() => statusMutation.mutate({ id: item.id, status: "pending" })}>{p.restore}</Button>}
      </CardContent></Card>;
    })}</div>}
  </div>;
}
