"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AddToProjectDialog } from "@/components/links/add-to-project-dialog";
import { useProjectLinkMutations } from "@/components/links/use-project-links";
import { CalendarSourceNotes } from "@/components/marketing/calendar-source-notes";
import { useMarketingCalendars, type MarketingView } from "@/components/marketing/use-marketing-calendars";
import { TipExportDialog } from "@/components/panels/tip-export-dialog";
import { Button } from "@/components/ui/button";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import {
  TIP_GROUPS,
  UNGROUPED_TIPS,
  groupTips,
  isTip,
  searchTips,
  tipGroupKey,
  tipSource,
  tipText,
  type TipGroup,
  type TipGroupKey,
} from "@/lib/ig-tips";
import { linkDescription } from "@/lib/link-export";
import {
  aggregateTipUsage,
  tipForDeepLink,
  unmatchedTipRefs,
  usageForTip,
  type MarketingCalendarsResponse,
  type TipUsage,
} from "@/lib/marketing-calendars";
import { resourceKey } from "@/lib/link-library";
import { nextProjectLinkOrder, projectsUsingLink } from "@/lib/project-links";
import type { EntityStatus } from "@/lib/queries/entities";
import { qk } from "@/lib/queries/keys";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import type { AiLink, Project, ProjectLink, Updater } from "@/lib/types";
import { useReturnFocus } from "@/lib/use-return-focus";
import { cn } from "@/lib/utils";

type Props = {
  aiLinks: AiLink[];
  setAiLinks: Updater<AiLink[]>;
  aiLinksStatus?: EntityStatus;
  projectLinks: ProjectLink[];
  setProjectLinks: Updater<ProjectLink[]>;
  projects: Project[];
  /** Fixture calendars for the preview; the live panel reads GitHub. */
  previewMarketingCalendars?: MarketingCalendarsResponse;
  /** `/ig-tips?q=<title>`: prefill the search and open that tip's card. */
  initialQuery?: string | null;
  onDeepLinkHandled?: () => void;
};

type TipForm = {
  recordType: "link" | "idea";
  title: string;
  url: string;
  group: TipGroup | "";
  summary: string;
  notes: string;
};

const emptyForm: TipForm = { recordType: "idea", title: "", url: "", group: "", summary: "", notes: "" };

/** Add https:// to a scheme-less URL and accept only a safe http(s) address. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return resourceKey(url.href) ? url.href : null;
  } catch {
    return null;
  }
}

const NO_USAGE: TipUsage[] = [];
const chip = "inline-flex min-h-11 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-ring sm:min-h-7";
const chipOn = "border-primary bg-surface-selected text-foreground";
const chipOff = "border-border text-foreground-muted hover:bg-surface-hover hover:text-foreground";

/**
 * IG TIPS: the library's idea records as their own section, grouped by
 * topic. Every card leads with a plain description of what the tip is and
 * how to use it; the research notes, the reasons, the projects and the
 * sources sit behind Details. Cards carry no icons.
 */
export function IgTipsPanel({
  aiLinks,
  setAiLinks,
  aiLinksStatus = { ready: true, failed: false },
  projectLinks,
  setProjectLinks,
  projects,
  previewMarketingCalendars,
  initialQuery = null,
  onDeepLinkHandled,
}: Props) {
  const t = useDict();
  const tt = t.tips;
  const m = t.marketing;
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  const relations = useProjectLinkMutations(setProjectLinks);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [groupFilter, setGroupFilter] = useState<TipGroupKey | "all">("all");
  const [notApplied, setNotApplied] = useState(false);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => {
    const target = tipForDeepLink(initialQuery, aiLinks.filter(isTip));
    return new Set(target ? [target.id] : []);
  });
  const [editing, setEditing] = useState<AiLink | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<TipForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [addToProjectTip, setAddToProjectTip] = useState<AiLink | null>(null);
  const returnFocus = useReturnFocus(dialogOpen);

  const tips = useMemo(() => aiLinks.filter(isTip), [aiLinks]);
  const calendars = useMarketingCalendars(previewMarketingCalendars);
  const calendarSources = calendars.view.kind === "ok" ? calendars.view.data.sources : null;
  const usage = useMemo(() => (calendarSources ? aggregateTipUsage(calendarSources) : null), [calendarSources]);
  const usageRead = usage !== null && usage.readSources.length > 0;
  const unmatchedRefs = useMemo(() => (usage ? unmatchedTipRefs(usage, tips.map((tip) => tip.title)) : 0), [usage, tips]);
  const groupLabel = (group: TipGroupKey) => tt.groupLabel[group];
  const searched = useMemo(() => searchTips(tips, query, (group) => tt.groupLabel[group]), [tips, query, tt.groupLabel]);
  const filtered = useMemo(
    () =>
      searched.filter(
        (tip) =>
          (groupFilter === "all" || tipGroupKey(tip) === groupFilter) &&
          (!notApplied || !usageRead || usageForTip(usage!, tip.title).length === 0),
      ),
    [searched, groupFilter, notApplied, usage, usageRead],
  );
  const notAppliedCount = useMemo(
    () => (usageRead ? tips.filter((tip) => usageForTip(usage!, tip.title).length === 0).length : 0),
    [tips, usage, usageRead],
  );
  const groups = useMemo(() => groupTips(filtered), [filtered]);
  const availableGroups = useMemo(() => groupTips(tips).map((entry) => entry.group), [tips]);
  const exportRelations = useMemo(() => ({ projectLinks, projects }), [projectLinks, projects]);
  const activeProjects = useMemo(() => projects.filter((project) => project.is_active), [projects]);
  const searching = query.trim().length > 0 || groupFilter !== "all" || (notApplied && usageRead);

  // Arriving through `/ig-tips?q=<title>`: once the tips are loaded, open the
  // card whose title is the query and bring it into view. Runs once; the
  // shell then forgets the query so a later visit starts clean.
  const deepLinkTipId = useMemo(() => tipForDeepLink(initialQuery, tips)?.id ?? null, [initialQuery, tips]);
  useEffect(() => {
    if (!initialQuery || !aiLinksStatus.ready) return;
    let inner = 0;
    const frame = window.requestAnimationFrame(() => {
      if (deepLinkTipId) setExpanded((previous) => (previous.has(deepLinkTipId) ? previous : new Set([...previous, deepLinkTipId])));
      inner = window.requestAnimationFrame(() => {
        if (deepLinkTipId) {
          const card = document.querySelector<HTMLElement>(`[data-tip-card="${CSS.escape(deepLinkTipId)}"]`);
          card?.scrollIntoView({ block: "start" });
          card?.querySelector<HTMLElement>("button[aria-controls]")?.focus({ preventScroll: true });
        }
        onDeepLinkHandled?.();
      });
    });
    return () => {
      window.cancelAnimationFrame(frame);
      window.cancelAnimationFrame(inner);
    };
  }, [initialQuery, aiLinksStatus.ready, deepLinkTipId, onDeepLinkHandled]);

  const toggle = (id: string) =>
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const saveTip = useMutation({
    mutationFn: async (vars: { id?: string; record_type: "link" | "idea"; title: string; url: string; tip_group: TipGroup | null; tip_summary: string | null; description: string | null }) => {
      const { id, ...values } = vars;
      if (id) {
        const { data, error } = await supabase
          .from("ai_links")
          .update({ ...values, updated_at: new Date().toISOString() })
          .eq("id", id)
          .select()
          .single();
        if (error || !data) throw error ?? new Error("no-data");
        return { saved: data as AiLink, created: false };
      }
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("ai_links")
        .insert({ ...values, user_id: userId, record_type: "idea", category_id: null, pricing: null })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return { saved: data as AiLink, created: true };
    },
    onSuccess: ({ saved, created }) => {
      setAiLinks((previous) => (created ? [saved, ...previous] : previous.map((link) => (link.id === saved.id ? saved : link))));
      toast.ok(created ? tt.created : tt.saved);
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
      setDialogOpen(false);
    },
    onError: (error) => toast.err((error as Error)?.message === "no-user" ? tt.signInFirst : tt.couldNotSave),
  });

  // Optimistic, with a rollback; project_links rows cascade in the database.
  const deleteTip = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_links").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.aiLinks });
      const previousLinks = qc.getQueryData<AiLink[]>(qk.aiLinks);
      const previousRelations = qc.getQueryData<ProjectLink[]>(qk.projectLinks);
      setAiLinks((old) => old.filter((link) => link.id !== id));
      setProjectLinks((old) => old.filter((relation) => relation.ai_link_id !== id));
      return { previousLinks, previousRelations };
    },
    onSuccess: () => toast.ok(tt.deleted),
    onError: (_error, _id, context) => {
      if (context?.previousLinks) setAiLinks(context.previousLinks);
      if (context?.previousRelations) setProjectLinks(context.previousRelations);
      toast.err(tt.couldNotDelete);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
      void qc.invalidateQueries({ queryKey: qk.projectLinks });
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(tip: AiLink) {
    const group = tipGroupKey(tip);
    setEditing(tip);
    setForm({
      recordType: "idea",
      title: tip.title,
      url: tip.url,
      group: group === UNGROUPED_TIPS ? "" : group,
      summary: tip.tip_summary ?? "",
      notes: tip.description ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const title = form.title.trim();
    if (!title) return setFormError(tt.titleRequired);
    if (!form.url.trim()) return setFormError(tt.urlRequired);
    const url = normalizeUrl(form.url);
    if (!url) return setFormError(tt.urlInvalid);
    if (aiLinks.some((tip) => tip.id !== editing?.id && (tip.record_type ?? "link") === form.recordType && (form.recordType === "link" || tip.title === title) && resourceKey(tip.url) === resourceKey(url))) {
      return setFormError(tt.duplicate);
    }
    saveTip.mutate({
      id: editing?.id,
      record_type: form.recordType,
      title,
      url,
      tip_group: form.group || null,
      tip_summary: form.summary.trim() || null,
      description: form.notes.trim() || null,
    });
  }

  async function remove(tip: AiLink) {
    if (
      await confirm({
        title: tt.delete,
        description: tt.deleteConfirm,
        confirmLabel: t.common.delete,
        cancelLabel: t.common.cancel,
        destructive: true,
      })
    ) {
      deleteTip.mutate(tip.id);
    }
  }

  const addButton = (
    <Button size="sm" onClick={openCreate}>
      {tt.addTip}
    </Button>
  );

  return (
    <div>
      <PageHeader
        title={tt.title}
        description={tt.description}
        action={
          <div className="flex flex-wrap gap-2">
            <TipExportDialog links={aiLinks} relations={exportRelations} />
            {addButton}
          </div>
        }
      />

      {!aiLinksStatus.ready ? (
        aiLinksStatus.failed ? (
          <p role="alert" className="text-sm text-destructive">{tt.loadFailed}</p>
        ) : (
          <div aria-live="polite" className="space-y-3">
            <p className="text-xs text-foreground-muted">{tt.loading}</p>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-40 w-full" />
              ))}
            </div>
          </div>
        )
      ) : tips.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface">
          <EmptyState title={tt.noTips} description={tt.noTipsDescription} action={addButton} className="py-16" />
        </div>
      ) : (
        <>
          <div className="mb-4 space-y-3">
            <Input
              aria-label={tt.searchPlaceholder}
              placeholder={tt.searchPlaceholder}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="h-9 w-full max-w-sm"
            />
            <div role="group" aria-label={tt.groupFilter} className="flex flex-wrap gap-1.5">
              {(["all", ...availableGroups] as const).map((group) => (
                <button
                  key={group}
                  type="button"
                  aria-pressed={groupFilter === group}
                  onClick={() => setGroupFilter(group)}
                  className={cn(chip, groupFilter === group ? chipOn : chipOff)}
                >
                  {group === "all" ? tt.allGroups : groupLabel(group)}
                </button>
              ))}
              {usageRead && (
                <button
                  type="button"
                  aria-pressed={notApplied}
                  onClick={() => setNotApplied((value) => !value)}
                  className={cn(chip, "sm:ml-2", notApplied ? chipOn : chipOff)}
                >
                  {m.notYetApplied}
                  <span className="ml-1.5 tabular text-foreground-subtle">{notAppliedCount}</span>
                </button>
              )}
            </div>
            <PlansStatus
              view={calendars.view}
              unmatchedRefs={unmatchedRefs}
              checking={calendars.checking}
              canCheck={calendars.canCheck}
              onCheckAgain={calendars.checkAgain}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p role="status" className="text-xs text-foreground-muted">{tt.resultCount(filtered.length, tips.length)}</p>
              {searching && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setQuery("");
                    setGroupFilter("all");
                    setNotApplied(false);
                  }}
                >
                  {tt.clearFilters}
                </Button>
              )}
            </div>
          </div>

          {groups.length === 0 ? (
            <EmptyState title={tt.noMatches} description={tt.noMatchesDescription} className="py-16" />
          ) : (
            <div className="space-y-8">
              {groups.map((entry) => (
                <section key={entry.group} aria-labelledby={`tips-${entry.group}`}>
                  <h2 id={`tips-${entry.group}`} className="mb-3 flex items-baseline gap-2 border-b border-border pb-2 text-sm font-semibold">
                    {groupLabel(entry.group)}
                    <span className="text-[11px] font-medium tabular text-foreground-muted">{tt.count(entry.tips.length)}</span>
                  </h2>
                  <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                    {entry.tips.map((tip) => (
                      <TipCard
                        key={tip.id}
                        tip={tip}
                        forProjects={projectsUsingLink(tip.id, projectLinks, projects).map(({ project }) => project.name)}
                        usage={usage ? usageForTip(usage, tip.title) : NO_USAGE}
                        expanded={expanded.has(tip.id)}
                        onToggle={() => toggle(tip.id)}
                        onEdit={() => openEdit(tip)}
                        onDelete={() => void remove(tip)}
                        onAddToProject={() => setAddToProjectTip(tip)}
                      />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto" onCloseAutoFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle>{editing ? tt.editTitle : tt.newTitle}</DialogTitle>
            <DialogDescription className="sr-only">{tt.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="mt-3 space-y-3">
            {editing && <div className="space-y-1.5">
              <Label htmlFor="tip-record-type">{t.ai.recordType}</Label>
              <SimpleSelect id="tip-record-type" value={form.recordType}
                onValueChange={(value) => setForm(current => ({ ...current, recordType: value as TipForm["recordType"] }))}
                options={[{ value: "idea", label: t.ai.ideaType }, { value: "link", label: t.ai.linkType }]} />
            </div>}
            <div className="space-y-1.5">
              <Label htmlFor="tip-title">{tt.titleLabel}</Label>
              <Input id="tip-title" value={form.title} maxLength={200} autoFocus onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tip-url">{tt.urlLabel}</Label>
              <Input id="tip-url" value={form.url} inputMode="url" placeholder="https://…" onChange={(event) => setForm((current) => ({ ...current, url: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tip-group">{tt.groupField}</Label>
              <SimpleSelect
                id="tip-group"
                value={form.group}
                onValueChange={(value) => setForm((current) => ({ ...current, group: value as TipGroup | "" }))}
                options={[{ value: "", label: tt.noGroup }, ...TIP_GROUPS.map((group) => ({ value: group, label: groupLabel(group) }))]}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tip-summary">{tt.summaryLabel}</Label>
              <Textarea
                id="tip-summary"
                value={form.summary}
                maxLength={2000}
                rows={5}
                aria-describedby="tip-summary-hint"
                onChange={(event) => setForm((current) => ({ ...current, summary: event.target.value }))}
              />
              <p id="tip-summary-hint" className="text-[11px] text-foreground-subtle">{tt.summaryHint}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tip-notes">{tt.notesLabel}</Label>
              <Textarea
                id="tip-notes"
                value={form.notes}
                rows={4}
                aria-describedby="tip-notes-hint"
                onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))}
              />
              <p id="tip-notes-hint" className="text-[11px] text-foreground-subtle">{tt.notesHint}</p>
            </div>
            {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">{tt.cancel}</Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={saveTip.isPending}>
                {saveTip.isPending ? tt.saving : editing ? tt.save : tt.create}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AddToProjectDialog
        open={addToProjectTip !== null}
        onOpenChange={(open) => !open && setAddToProjectTip(null)}
        linkTitle={addToProjectTip?.title ?? ""}
        projects={addToProjectTip ? activeProjects.filter((project) => !projectLinks.some((relation) => relation.project_id === project.id && relation.ai_link_id === addToProjectTip.id)) : []}
        onSave={async ({ projectId, role, note }) => {
          if (!addToProjectTip) return false;
          const saved = await relations.upsert([
            { project_id: projectId, ai_link_id: addToProjectTip.id, role, note, sort_order: nextProjectLinkOrder(projectId, projectLinks) },
          ]);
          return saved !== null;
        }}
      />
    </div>
  );
}

/** Plain text with its http(s) addresses as links. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/[^\s)]+)/g).map((part, index) =>
        /^https?:\/\//.test(part) && resourceKey(part) ? (
          <a key={index} href={part} target="_blank" rel="noreferrer" className="focus-ring rounded underline [overflow-wrap:anywhere]">
            {part}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function TipCard({
  tip,
  forProjects,
  usage,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onAddToProject,
}: {
  tip: AiLink;
  forProjects: string[];
  /** The marketing calendars that apply this tip, with entry counts. */
  usage: TipUsage[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onAddToProject: () => void;
}) {
  const tt = useDict().tips;
  const t = useDict();
  const text = tipText(tip);
  const notes = linkDescription(tip)?.trim() ?? "";
  const source = tipSource(tip);
  const sourceLine =
    source.kind === "instagram" ? tt.sourceInstagram(source.count) : source.kind === "web" ? tt.sourceWeb(source.host) : null;
  const safeUrl = resourceKey(tip.url) ? tip.url : undefined;
  const sources = [...new Set((tip.source_urls ?? []).filter((url) => /^https?:\/\//i.test(url) && resourceKey(url)))];
  const relevance = tip.project_relevance ?? [];
  const detailsId = `tip-details-${tip.id}`;
  const action = "inline-flex min-h-11 items-center rounded-md px-2 text-xs font-medium focus-ring md:min-h-8";
  return (
    <li data-tip-card={tip.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
      <div className="flex-1 px-3.5 pb-3 pt-3">
        <h3 className="text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">{tip.title}</h3>
        <p className={cn("mt-2 text-[13px] leading-5 [overflow-wrap:anywhere]", text ? "text-foreground" : "italic text-foreground-subtle")}>
          {text || tt.noSummary}
        </p>
        {(sourceLine || forProjects.length > 0) && (
          <p className="mt-2 text-[11px] text-foreground-muted [overflow-wrap:anywhere]">
            {[sourceLine, forProjects.length > 0 ? tt.forProjects(forProjects.join(", ")) : null].filter(Boolean).join(" · ")}
          </p>
        )}
        {usage.length > 0 && (
          <p data-tip-usage className="mt-1 flex flex-wrap items-center gap-x-1 text-[11px] text-foreground-muted">
            <span>{t.marketing.appliedIn}</span>{" "}
            {usage.map((item, index) => (
              <span key={item.sourceId} className="inline-flex items-center">
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="focus-ring inline-flex min-h-11 items-center rounded font-medium text-foreground underline hover:no-underline md:min-h-6"
                >
                  {t.marketing.usageLink(item.label, item.count)}
                  <span className="sr-only"> {t.marketing.opensInNewTab}</span>
                </a>
                {index < usage.length - 1 && ", "}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-1 border-t border-border px-1.5 py-1">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={`${expanded ? tt.hideDetails : tt.details}: ${tip.title}`}
          className={cn(action, "text-foreground hover:bg-surface-hover")}
        >
          {expanded ? tt.hideDetails : tt.details}
        </button>
        {safeUrl && (
          <a href={safeUrl} target="_blank" rel="noreferrer" className={cn(action, "text-foreground-muted hover:bg-surface-hover hover:text-foreground")}>
            {tt.openOriginal}
            <span className="sr-only"> {tt.opensInNewTab}: {tip.title}</span>
          </a>
        )}
        <button type="button" onClick={onEdit} aria-label={`${tt.edit}: ${tip.title}`} className={cn(action, "ml-auto text-foreground-muted hover:bg-surface-hover hover:text-foreground")}>
          {tt.edit}
        </button>
        <button type="button" onClick={onDelete} aria-label={`${tt.delete}: ${tip.title}`} className={cn(action, "text-foreground-muted hover:bg-surface-hover hover:text-destructive")}>
          {tt.delete}
        </button>
      </div>
      <div id={detailsId} hidden={!expanded} className="space-y-3 border-t border-border bg-surface-muted/30 px-3.5 py-3 text-xs text-foreground-muted">
        {notes && notes !== text && (
          <div>
            <p className="font-medium text-foreground">{tt.notes}</p>
            <p className="mt-1 whitespace-pre-line [overflow-wrap:anywhere]"><Linkified text={notes} /></p>
          </div>
        )}
        {tip.rating_rationale && (
          <div>
            <p className="font-medium text-foreground">
              {tt.whyUseful}
              {tip.usefulness_rating != null && <span className="font-normal text-foreground-muted"> · {tt.usefulness(tip.usefulness_rating)}</span>}
            </p>
            <p className="mt-1 [overflow-wrap:anywhere]">{tip.rating_rationale}</p>
          </div>
        )}
        {relevance.length > 0 && (
          <div>
            <p className="font-medium text-foreground">{tt.projectsThatBenefit}</p>
            <ul className="mt-1 space-y-1 [overflow-wrap:anywhere]">
              {relevance.map((item) => (
                <li key={`${item.repository}-${item.reason}`}>
                  <span className="font-medium text-foreground">{item.repository}</span>: {item.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        {sources.length > 0 && (
          <div>
            <p className="font-medium text-foreground">{tt.sources}</p>
            <ul className="mt-1 space-y-1">
              {sources.map((url) => (
                <li key={url}>
                  <a href={url} target="_blank" rel="noreferrer" className="focus-ring inline-flex min-h-8 items-center rounded underline [overflow-wrap:anywhere]">
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
        <button type="button" onClick={onAddToProject} className={cn(action, "px-0 text-foreground underline hover:no-underline")}>
          {t.ai.addToProject}
        </button>
      </div>
    </li>
  );
}

/**
 * Which marketing calendars the "Applied in" counts come from, or why they
 * could not be read. Plain text rather than a live region: the tip count
 * above is the section's status.
 */
function PlansStatus({
  view,
  unmatchedRefs,
  checking,
  canCheck,
  onCheckAgain,
}: {
  view: MarketingView;
  unmatchedRefs: number;
  checking: boolean;
  canCheck: boolean;
  onCheckAgain: () => void;
}) {
  const m = useDict().marketing;
  const read = view.kind === "ok" ? view.data.sources.filter((source) => source.status === "ok") : [];
  return (
    <div data-plans-status className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 rounded-md border border-border bg-surface-inset px-3 py-2 text-xs">
      <div className="min-w-0 space-y-1">
        {view.kind === "loading" ? (
          <p className="text-foreground-muted">{m.loading}</p>
        ) : view.kind !== "ok" ? (
          <p className="text-warning">{view.kind === "rate-limited" ? m.rateLimited : view.kind === "signed-out" ? m.signedOut : m.loadError}</p>
        ) : (
          <>
            {read.length > 0 && (
              <p className="text-foreground-muted [overflow-wrap:anywhere]">
                {m.plansRead(read.map((source) => m.calendarEntries(source.label, source.calendar?.entries.length ?? 0)).join(", "))}
              </p>
            )}
            <CalendarSourceNotes sources={view.data.sources} />
            {unmatchedRefs > 0 && <p className="text-foreground-muted">{m.unmatchedRefs(unmatchedRefs)}</p>}
          </>
        )}
      </div>
      {canCheck && (
        <Button size="sm" variant="ghost" onClick={onCheckAgain} disabled={checking} className="min-h-11 sm:min-h-0">
          {checking ? m.checking : m.checkAgain}
        </Button>
      )}
    </div>
  );
}
