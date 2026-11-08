"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, ListChecks } from "lucide-react";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { EntityBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { useLang } from "@/lib/i18n";
import { backlog as strings } from "@/lib/i18n/sections/backlog";
import { qk } from "@/lib/queries/keys";
import {
  BACKLOG_PROJECTS,
  BACKLOG_STATUSES,
  backlogProjectCounts,
  backlogRefHref,
  fetchBacklogItems,
  filterBacklog,
  updateBacklogStatus,
  type BacklogFilter,
  type BacklogItem,
  type BacklogStatus,
} from "@/lib/backlog";
import { cn } from "@/lib/utils";

/** Sample tasks for /dev-preview: the panel never calls Supabase there. */
export const PREVIEW_BACKLOG: BacklogItem[] = [
  { id: "00000000-0000-4000-8000-0000000000b1", project: "DNESKAi", title: "Shorter closing slide on Threads", description: "The closing line wraps on narrow phones.", status: "open", source: "claude:dneskai", external_ref: null, created_at: "2026-11-08T09:00:00.000Z", updated_at: "2026-11-08T09:00:00.000Z" },
  { id: "00000000-0000-4000-8000-0000000000b2", project: "devShark", title: "Five new concepts for next week", description: null, status: "in_progress", source: "claude:devshark", external_ref: null, created_at: "2026-11-08T08:00:00.000Z", updated_at: "2026-11-08T10:00:00.000Z" },
  { id: "00000000-0000-4000-8000-0000000000b3", project: "personal", title: "Renew the domain", description: "Before the end of the month.", status: "open", source: "owner", external_ref: null, created_at: "2026-11-07T18:00:00.000Z", updated_at: "2026-11-07T18:00:00.000Z" },
  { id: "00000000-0000-4000-8000-0000000000b4", project: "heyDarlink", title: "Fix the search error message", description: null, status: "done", source: "claude:audit", external_ref: "LDEV-1", created_at: "2026-11-07T12:00:00.000Z", updated_at: "2026-11-08T07:00:00.000Z" },
];

const STATUS_TONE: Record<BacklogStatus, string> = {
  open: "border-border bg-surface",
  in_progress: "border-warning/40 bg-warning/5",
  done: "border-dashed border-border bg-surface-inset",
  dropped: "border-dashed border-border bg-surface-inset",
};

export function BacklogPanel({ isPreview = false }: { isPreview?: boolean }) {
  const { lang } = useLang();
  const t = strings[lang];
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: qk.backlog, queryFn: fetchBacklogItems, enabled: !isPreview, staleTime: 30_000 });
  const [previewItems, setPreviewItems] = useState(PREVIEW_BACKLOG);
  const items = useMemo(() => isPreview ? previewItems : query.data ?? [], [isPreview, previewItems, query.data]);
  const [filter, setFilter] = useState<BacklogFilter>({ project: "all", status: "active" });
  const [failed, setFailed] = useState<string | null>(null);
  const shown = useMemo(() => filterBacklog(items, filter), [items, filter]);
  const counts = useMemo(() => backlogProjectCounts(items, filter.status), [items, filter.status]);

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BacklogStatus }) => updateBacklogStatus(id, status),
    onMutate: async ({ id, status }) => {
      setFailed(null);
      await queryClient.cancelQueries({ queryKey: qk.backlog });
      const before = queryClient.getQueryData<BacklogItem[]>(qk.backlog);
      queryClient.setQueryData<BacklogItem[]>(qk.backlog, (old) => old?.map((item) => item.id === id ? { ...item, status } : item));
      return { before };
    },
    onError: (_error, { id }, context) => { queryClient.setQueryData(qk.backlog, context?.before); setFailed(id); },
    onSuccess: (row) => queryClient.setQueryData<BacklogItem[]>(qk.backlog, (old) => old?.map((item) => item.id === row.id ? row : item)),
  });
  const setStatus = (id: string, status: BacklogStatus) => {
    if (isPreview) setPreviewItems((old) => old.map((item) => item.id === id ? { ...item, status } : item));
    else mutation.mutate({ id, status });
  };

  const projectOptions = [{ value: "all", label: `${t.allProjects} (${counts.all})` }, ...BACKLOG_PROJECTS.map((project) => ({ value: project, label: `${t.projects[project]} (${counts[project]})` }))];
  const statusOptions = [{ value: "active", label: t.activeStatuses }, { value: "all", label: t.allStatuses }, ...BACKLOG_STATUSES.map((status) => ({ value: status, label: t.statuses[status] }))];
  const statusChoices = BACKLOG_STATUSES.map((status) => ({ value: status, label: t.statuses[status] }));

  return <section className="min-w-0" data-testid="backlog-panel">
    <PageHeader title={t.title} description={t.description} />
    <div className="mb-4 flex flex-wrap items-end gap-3">
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.project}
        <SimpleSelect value={filter.project} onValueChange={(value) => setFilter((old) => ({ ...old, project: value as BacklogFilter["project"] }))} options={projectOptions} aria-label={t.project} className="w-56" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-foreground-muted">{t.status}
        <SimpleSelect value={filter.status} onValueChange={(value) => setFilter((old) => ({ ...old, status: value as BacklogFilter["status"] }))} options={statusOptions} aria-label={t.status} className="w-56" />
      </label>
      <p className="pb-2 text-xs tabular-nums text-foreground-muted" aria-live="polite">{t.count(shown.length, items.length)}</p>
    </div>
    {isPreview && <p className="mb-3 text-xs text-foreground-muted">{t.previewOnly}</p>}
    {!isPreview && query.isPending ? <p role="status" className="text-sm text-foreground-muted">{t.loading}</p>
      : !isPreview && query.isError ? <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
      : items.length === 0 ? <EmptyState icon={ListChecks} title={t.empty} description={t.emptyHint} />
      : shown.length === 0 ? <p className="text-sm text-foreground-muted">{t.noMatch}</p>
      : <ul className="grid gap-2" aria-label={t.title}>
        {shown.map((item) => {
          const href = backlogRefHref(item.external_ref);
          return <li key={item.id}>
            <Card className={cn("flex flex-col gap-3 p-3 sm:flex-row sm:items-start sm:justify-between", STATUS_TONE[item.status])}>
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <EntityBadge>{t.projects[item.project]}</EntityBadge>
                  {item.external_ref && (href
                    ? <a href={href} target="_blank" rel="noreferrer" className="inline-flex min-h-6 items-center gap-1 text-xs font-medium text-foreground underline underline-offset-2 hover:no-underline focus-ring">{item.external_ref}<ExternalLink className="h-3 w-3" aria-hidden /></a>
                    : <span className="text-xs text-foreground-muted">{item.external_ref}</span>)}
                </div>
                <p className={cn("text-sm font-medium break-words", (item.status === "done" || item.status === "dropped") && "line-through decoration-foreground-muted")}>{item.title}</p>
                {item.description && <p className="whitespace-pre-line text-xs break-words text-foreground-muted">{item.description}</p>}
                {item.source && <p className="text-[11px] text-foreground-muted">{t.addedBy(item.source)}</p>}
                {failed === item.id && <p role="alert" className="text-xs text-risk">{t.saveFailed}</p>}
              </div>
              <SimpleSelect value={item.status} onValueChange={(value) => setStatus(item.id, value as BacklogStatus)} options={statusChoices} aria-label={t.statusOf(item.title)} className="w-full shrink-0 sm:w-40" />
            </Card>
          </li>;
        })}
      </ul>}
  </section>;
}
