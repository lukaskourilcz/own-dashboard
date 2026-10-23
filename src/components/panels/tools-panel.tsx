"use client";

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ExternalLink, Library, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { EntityBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { LinkPickerDialog } from "@/components/links/link-picker-dialog";
import { useProjectLinkMutations } from "@/components/links/use-project-links";
import { PricingDot } from "@/components/panels/link-library-card";
import { DetectedToolsSection, type DetectionView } from "@/components/tools/detected-tools-section";
import { loadDetectedTools } from "@/lib/github";
import { useDict } from "@/lib/i18n";
import { resourceKey } from "@/lib/link-library";
import { nextProjectLinkOrder } from "@/lib/project-links";
import { qk } from "@/lib/queries/keys";
import {
  MAX_DETECTED_REPOSITORIES,
  partitionDetectedTools,
  toolKey,
  type DetectedTool,
  type DetectedToolsResponse,
} from "@/lib/stack-detection";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import {
  TOOL_STATUSES,
  filterToolsByProject,
  groupToolsByStatus,
  toolMonthlyCost,
  toolName,
  toolUsage,
} from "@/lib/tools";
import { useReturnFocus } from "@/lib/use-return-focus";
import { formatCurrency } from "@/lib/utils";
import type {
  AiCategory,
  AiLink,
  Project,
  ProjectLink,
  Subscription,
  Tool,
  ToolStatus,
  Updater,
} from "@/lib/types";

type Props = {
  tools: Tool[];
  setTools: Updater<Tool[]>;
  aiLinks: AiLink[];
  aiCategories: AiCategory[];
  projects: Project[];
  projectLinks: ProjectLink[];
  setProjectLinks: Updater<ProjectLink[]>;
  subscriptions: Subscription[];
  displayCurrency: string;
  onShowInLibrary: (linkId: string) => void;
  /** The fixture preview's detection; the live app reads the repositories. */
  previewDetectedTools?: DetectedToolsResponse;
};

type UsageDraft = { project_id: string; note: string };

const NO_DETECTED_TOOLS: DetectedTool[] = [];

type ToolForm = {
  id?: string;
  ai_link_id: string;
  name: string;
  what_it_does: string;
  status: ToolStatus;
  subscription_id: string;
  usage: UsageDraft[];
};

/**
 * Tools: what the active projects really use. The tools each repository
 * lists in its about-project.md (or package.json) arrive by themselves and are
 * marked as detected; the library links the owner adds by hand keep what they
 * do, a status, a monthly cost from a linked subscription and one row per
 * project with how it helps (project_links, role "tool"). A detected tool
 * with the name of a hand-added one never shows twice: the hand-added card
 * names the repositories that also list it.
 */
export function ToolsPanel({
  tools,
  setTools,
  aiLinks,
  aiCategories,
  projects,
  projectLinks,
  setProjectLinks,
  subscriptions,
  displayCurrency,
  onShowInLibrary,
  previewDetectedTools,
}: Props) {
  const t = useDict();
  const tt = t.tools;
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirmation();
  const relations = useProjectLinkMutations(setProjectLinks, projectLinks);
  const [projectFilter, setProjectFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [form, setForm] = useState<ToolForm | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const returnFocus = useReturnFocus(form !== null);

  // Cache repository reads for 30 minutes. Reopening after that window or
  // explicitly checking again refreshes; focus alone never spends a read.
  const detection = useQuery({
    queryKey: qk.detectedTools,
    queryFn: loadDetectedTools,
    enabled: !previewDetectedTools,
    staleTime: 30 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const view: DetectionView = previewDetectedTools
    ? { kind: "ok", data: previewDetectedTools }
    : detection.data
      ? detection.data.kind === "ok"
        ? { kind: "ok", data: detection.data.data }
        : { kind: detection.data.kind }
      : detection.isError
        ? { kind: "error" }
        : { kind: "loading" };
  const checking = !previewDetectedTools && detection.isFetching;

  const linkById = useMemo(() => new Map(aiLinks.map((link) => [link.id, link])), [aiLinks]);
  const categoryName = useMemo(() => new Map(aiCategories.map((category) => [category.id, category.name])), [aiCategories]);
  const detectedTools =
    previewDetectedTools?.tools ?? (detection.data?.kind === "ok" ? detection.data.data.tools : NO_DETECTED_TOOLS);
  const { unmatched, matches } = useMemo(
    () => partitionDetectedTools(detectedTools, tools, (tool) => [tool.name, linkById.get(tool.ai_link_id)?.title]),
    [detectedTools, tools, linkById],
  );
  const search = toolKey(query);
  const visible = useMemo(
    () =>
      filterToolsByProject(tools, projectLinks, projectFilter).filter(
        (tool) => !search || toolKey(`${toolName(tool, linkById.get(tool.ai_link_id))} ${tool.what_it_does}`).includes(search),
      ),
    [tools, projectLinks, projectFilter, search, linkById],
  );
  const visibleDetected = useMemo(
    () =>
      unmatched.filter(
        (tool) =>
          (projectFilter === "all" || tool.projects.some((usage) => usage.id === projectFilter)) &&
          (!search ||
            toolKey(`${tool.name} ${tool.whatItDoes} ${tool.projects.map((usage) => `${usage.name} ${usage.note}`).join(" ")}`).includes(search)),
      ),
    [unmatched, projectFilter, search],
  );
  const groups = useMemo(() => groupToolsByStatus(visible, aiLinks), [visible, aiLinks]);
  const toolLinkIds = useMemo(() => new Set(tools.map((tool) => tool.ai_link_id)), [tools]);
  const usageByLink = useMemo(() => {
    const projectById = new Map(projects.map(project => [project.id, project]));
    const result = new Map<string, { relation: ProjectLink; project: Project }[]>();
    for (const relation of projectLinks) {
      const project = projectById.get(relation.project_id);
      if (relation.role !== "tool" || !project) continue;
      const entries = result.get(relation.ai_link_id) ?? [];
      entries.push({ relation, project }); result.set(relation.ai_link_id, entries);
    }
    for (const entries of result.values()) entries.sort((a, b) => a.project.name.localeCompare(b.project.name));
    return result;
  }, [projects, projectLinks]);
  const costByTool = useMemo(() => {
    const byId = new Map(subscriptions.map(subscription => [subscription.id, subscription]));
    return new Map(tools.map(tool => {
      const subscription = tool.subscription_id ? byId.get(tool.subscription_id) : undefined;
      return [tool.id, toolMonthlyCost(tool, subscription ? [subscription] : [], displayCurrency)];
    }));
  }, [tools, subscriptions, displayCurrency]);

  function startCreate(linkId: string) {
    setFormError(null);
    setForm({ ai_link_id: linkId, name: "", what_it_does: "", status: "in_use", subscription_id: "", usage: toolUsage({ ai_link_id: linkId }, projectLinks, projects).map(({ relation }) => ({ project_id: relation.project_id, note: relation.note })) });
  }

  function startEdit(tool: Tool) {
    setFormError(null);
    setForm({
      id: tool.id,
      ai_link_id: tool.ai_link_id,
      name: tool.name ?? "",
      what_it_does: tool.what_it_does,
      status: tool.status,
      subscription_id: tool.subscription_id ?? "",
      usage: toolUsage(tool, projectLinks, projects).map(({ relation }) => ({ project_id: relation.project_id, note: relation.note })),
    });
  }

  async function writeTool(values: Partial<Omit<Tool, "id" | "user_id" | "created_at" | "updated_at">>, id?: string): Promise<Tool> {
    const supabase = createClient();
    try {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error(tt.signInFirst);
      const { data, error } = id
        ? await supabase.from("tools").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).select().single()
        : await supabase.from("tools").insert({ ...values, user_id: userId }).select().single();
      if (error || !data || typeof data.id !== "string" || data.user_id !== userId || (id && data.id !== id)) throw new Error(tt.couldNotSave);
      const saved = data as Tool;
      setTools(previous => [...previous.filter(tool => tool.id !== saved.id), saved]);
      return saved;
    } finally { void qc.invalidateQueries({ queryKey: qk.tools }); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form || savingRef.current) return;
    const draft = form;
    const whatItDoes = draft.what_it_does.trim();
    if (!whatItDoes) { setFormError(tt.whatItDoesRequired); return; }
    savingRef.current = true; setSaving(true); setFormError(null);
    let headerSaved = false;
    try {
      const saved = await writeTool({
        ai_link_id: draft.ai_link_id, name: draft.name.trim() || null,
        what_it_does: whatItDoes, status: draft.status, subscription_id: draft.subscription_id || null,
      }, draft.id);
      headerSaved = true;
      // Retain the confirmed identity if project links fail: retry updates this
      // tool instead of inserting it again, and keeps all project-note drafts.
      setForm(current => current ? { ...current, id: saved.id } : current);
      const existing = projectLinks.filter(row => row.ai_link_id === saved.ai_link_id && row.role === "tool");
      const wanted = new Set(draft.usage.map(row => row.project_id));
      const removed = existing.filter(row => !wanted.has(row.project_id)).map(row => row.id);
      // Add/update first so a failed upsert cannot first remove existing usage.
      const linked = await relations.upsert(draft.usage.map(row => ({
        project_id: row.project_id, ai_link_id: saved.ai_link_id, role: "tool", note: row.note.trim(),
        sort_order: projectLinks.find(item => item.project_id === row.project_id && item.ai_link_id === saved.ai_link_id)?.sort_order
          ?? nextProjectLinkOrder(row.project_id, projectLinks),
      })), { silent: true });
      if (linked === null || !await relations.remove(removed, { silent: true })) throw new Error("links-not-confirmed");
      toast.ok(draft.id ? tt.saved : tt.created);
      setForm(null);
    } catch (error) {
      setFormError(headerSaved ? tt.projectLinksFailed : error instanceof Error && error.message === tt.signInFirst ? tt.signInFirst : tt.couldNotSave);
    } finally { savingRef.current = false; setSaving(false); }
  }

  async function setStatus(tool: Tool, status: ToolStatus) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      // A status change must not overwrite newer name/description/cost edits.
      await writeTool({ status }, tool.id);
      toast.ok(tt.saved);
    } catch { toast.err(tt.couldNotSave); }
    finally { savingRef.current = false; setSaving(false); }
  }

  async function removeTool(tool: Tool) {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      if (!(await confirm({ title: tt.deleteTool, description: tt.deleteToolConfirm,
        confirmLabel: t.common.delete, cancelLabel: t.common.cancel, destructive: true }))) return;
      const { error } = await createClient().from("tools").delete().eq("id", tool.id);
      if (error) throw error;
      setTools(previous => previous.filter(item => item.id !== tool.id));
      toast.ok(tt.deleted);
      setForm(current => current?.id === tool.id ? null : current);
    } catch { toast.err(tt.couldNotSave); }
    finally {
      void qc.invalidateQueries({ queryKey: qk.tools });
      savingRef.current = false; setSaving(false);
    }
  }

  const formLink = form ? linkById.get(form.ai_link_id) : undefined;
  const formTool = form?.id ? tools.find((tool) => tool.id === form.id) : undefined;
  const unusedProjects = form ? projects.filter((project) => !form.usage.some((row) => row.project_id === project.id)) : [];
  // The project filter offers every project a hand-added or a detected tool
  // mentions.
  const detectedProjectIds = new Set(unmatched.flatMap((tool) => tool.projects.map((usage) => usage.id)));
  const projectsWithTools = projects.filter(
    (project) =>
      detectedProjectIds.has(project.id) ||
      projectLinks.some((row) => row.project_id === project.id && row.role === "tool" && toolLinkIds.has(row.ai_link_id)),
  );
  const filtering = search.length > 0 || projectFilter !== "all";

  return (
    <div>
      <PageHeader
        title={tt.title}
        description={tt.description}
        action={
          <Button size="sm" disabled={saving} onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {tt.addTool}
          </Button>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-xs text-foreground-muted">
          {tools.length > 0 && tt.count(visible.length)}
        </p>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Input
            aria-label={tt.filterTools}
            placeholder={tt.filterTools}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="h-11 w-full sm:h-9 sm:w-56"
          />
          {projectsWithTools.length > 0 && (
            <SimpleSelect
              aria-label={tt.projectFilter}
              value={projectFilter}
              onValueChange={setProjectFilter}
              className="w-full sm:w-56"
              options={[
                { value: "all", label: tt.allProjects },
                ...projectsWithTools.map((project) => ({ value: project.id, label: project.name })),
              ]}
            />
          )}
        </div>
      </div>

      <div className="space-y-6">
        {tools.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-border px-4 py-3">
            <div className="min-w-0 max-w-2xl">
              <p className="text-sm font-medium text-foreground">{tt.manualEmpty}</p>
              <p className="mt-0.5 text-xs text-foreground-muted">{tt.manualEmptyDescription}</p>
            </div>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => setPickerOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              {tt.addTool}
            </Button>
          </div>
        ) : groups.length === 0 ? (
          <p className="text-sm text-foreground-muted">{tt.noToolsForProject}</p>
        ) : (
          groups.map((group) => (
            <section key={group.status} aria-labelledby={`tools-${group.status}`}>
              <h2 id={`tools-${group.status}`} className="mb-3 flex items-baseline gap-2 border-b border-border pb-2 text-sm font-semibold">
                {tt.statusLabel[group.status]}
                <span className="text-[11px] font-medium tabular text-foreground-muted">{tt.count(group.tools.length)}</span>
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {group.tools.map((tool) => {
                  const link = linkById.get(tool.ai_link_id);
                  const name = toolName(tool, link);
                  const usage = usageByLink.get(tool.ai_link_id) ?? [];
                  const cost = costByTool.get(tool.id);
                  const safeUrl = link && resourceKey(link.url) ? link.url : undefined;
                  const category = link?.category_id ? categoryName.get(link.category_id) : undefined;
                  const detected = matches.get(tool);
                  return (
                    <li key={tool.id} data-tool-card={tool.id} className="flex min-w-0 flex-col rounded-lg border border-border bg-surface">
                      <div className="flex min-h-16 items-start gap-2 border-b border-border px-3 py-2.5">
                        <span className="mt-1"><PricingDot pricing={link?.pricing ?? null} /></span>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate text-sm font-semibold" title={name}>{name}</h3>
                          <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px] text-foreground-muted">
                            {category && <EntityBadge className="min-h-5 py-0">{category}</EntityBadge>}
                            {cost != null && <span className="tabular">{tt.monthly(formatCurrency(cost, displayCurrency))}</span>}
                          </div>
                        </div>
                      </div>
                      <div className="flex-1 space-y-2.5 px-3 py-2.5">
                        <p className="text-sm text-foreground [overflow-wrap:anywhere]">{tool.what_it_does}</p>
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-foreground-subtle">{tt.usedIn}</p>
                          {usage.length === 0 ? (
                            <p className="mt-1 text-xs text-foreground-muted">{tt.notUsedYet}</p>
                          ) : (
                            <ul className="mt-1 divide-y divide-border" aria-label={`${tt.usedIn}: ${name}`}>
                              {usage.map(({ relation, project }) => (
                                <li key={relation.id} className="py-1.5 text-xs">
                                  <span className="font-medium text-foreground">{project.name}</span>
                                  {relation.note && <span className="text-foreground-muted"> — {relation.note}</span>}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                        {detected && (
                          <p data-tool-detected-in className="text-[11px] text-foreground-subtle [overflow-wrap:anywhere]">
                            {tt.alsoInRepositories(detected.projects.map((project) => project.name).join(", "))}
                          </p>
                        )}
                      </div>
                      <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
                        {safeUrl && (
                          <Tooltip content={tt.openLink}>
                            <Button asChild size="icon-sm" className="h-11 w-11 md:h-8 md:w-8" variant="ghost">
                              <a href={safeUrl} target="_blank" rel="noreferrer" aria-label={`${tt.openLink}: ${name}`}><ExternalLink /></a>
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content={tt.showInLibrary}>
                          <Button size="icon-sm" className="h-11 w-11 md:h-8 md:w-8" variant="ghost" onClick={() => onShowInLibrary(tool.ai_link_id)} aria-label={`${tt.showInLibrary}: ${name}`}><Library /></Button>
                        </Tooltip>
                        <Tooltip content={t.common.edit}>
                          <Button size="icon-sm" className="h-11 w-11 md:h-8 md:w-8" variant="ghost" disabled={saving} onClick={() => startEdit(tool)} aria-label={`${t.common.edit}: ${name}`}><Pencil /></Button>
                        </Tooltip>
                        <div className="ml-auto">
                          {tool.status === "retired" ? (
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setStatus(tool, "in_use")} aria-label={`${tt.markInUse}: ${name}`}>
                              <RotateCcw className="h-3.5 w-3.5" />
                              {tt.markInUse}
                            </Button>
                          ) : (
                            <Button size="sm" variant="ghost" disabled={saving} onClick={() => void setStatus(tool, "retired")} aria-label={`${tt.markRetired}: ${name}`}>
                              <Archive className="h-3.5 w-3.5" />
                              {tt.markRetired}
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}

        <DetectedToolsSection
          view={view}
          tools={visibleDetected}
          filtered={filtering}
          checking={checking}
          canCheck={!previewDetectedTools}
          onCheckAgain={() => void detection.refetch()}
          maxRepositories={MAX_DETECTED_REPOSITORIES}
        />
      </div>

      <LinkPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        links={aiLinks}
        categories={aiCategories}
        excludeIds={toolLinkIds}
        recordType="link"
        multiple={false}
        title={tt.pickTool}
        description={tt.pickToolDescription}
        onConfirm={([id]) => {
          if (id) startCreate(id);
        }}
      />

      <Dialog open={form !== null} onOpenChange={(open) => !open && !savingRef.current && setForm(null)}>
        <DialogContent showClose={!saving} className="max-h-[90vh] overflow-y-auto sm:max-w-lg" onCloseAutoFocus={returnFocus}>
          <DialogHeader>
            <DialogTitle>{form?.id ? tt.editTool : tt.newTool(formLink?.title ?? "")}</DialogTitle>
            <DialogDescription>{formLink?.url}</DialogDescription>
          </DialogHeader>
          {form && (
            <form onSubmit={submit}>
              <fieldset disabled={saving} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="tool-name">{tt.name}</Label>
                <Input id="tool-name" value={form.name} maxLength={120} placeholder={tt.namePlaceholder(formLink?.title ?? "")} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tool-what">{tt.whatItDoes}</Label>
                <Textarea required id="tool-what" value={form.what_it_does} maxLength={600} rows={3} placeholder={tt.whatItDoesPlaceholder} onChange={(e) => setForm({ ...form, what_it_does: e.target.value })} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="tool-status">{tt.status}</Label>
                  <SimpleSelect
                    id="tool-status"
                    value={form.status}
                    onValueChange={(value) => setForm({ ...form, status: value as ToolStatus })}
                    options={TOOL_STATUSES.map((status) => ({ value: status, label: tt.statusLabel[status] }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tool-subscription">{tt.subscription}</Label>
                  <SimpleSelect
                    id="tool-subscription"
                    value={form.subscription_id}
                    onValueChange={(value) => setForm({ ...form, subscription_id: value })}
                    options={[
                      { value: "", label: tt.noSubscription },
                      ...subscriptions.map((subscription) => ({ value: subscription.id, label: subscription.name })),
                    ]}
                  />
                </div>
              </div>
              <p className="text-[11px] text-foreground-subtle">{tt.subscriptionHint}</p>
              <fieldset className="space-y-2 rounded-md border border-border p-3">
                <legend className="px-1 text-xs font-semibold">{tt.usedIn}</legend>
                <p className="text-[11px] text-foreground-subtle">{tt.usedInHint}</p>
                {form.usage.map((row) => {
                  const project = projects.find((item) => item.id === row.project_id);
                  const label = project?.name ?? row.project_id;
                  return (
                    <div key={row.project_id} className="flex items-center gap-2">
                      <div className="min-w-0 flex-1 space-y-1">
                        <Label htmlFor={`tool-usage-${row.project_id}`} className="text-xs">{label}</Label>
                        <Input
                          id={`tool-usage-${row.project_id}`}
                          value={row.note}
                          maxLength={500}
                          placeholder={tt.projectNote(label)}
                          onChange={(e) => setForm({ ...form, usage: form.usage.map((item) => (item.project_id === row.project_id ? { ...item, note: e.target.value } : item)) })}
                          className="h-11 text-xs md:h-8"
                        />
                      </div>
                      <Tooltip content={tt.removeProject(label)}>
                        <Button type="button" size="icon-sm" variant="ghost" className="h-11 w-11 md:h-8 md:w-8 mt-5" aria-label={tt.removeProject(label)} onClick={() => setForm({ ...form, usage: form.usage.filter((item) => item.project_id !== row.project_id) })}>
                          <X />
                        </Button>
                      </Tooltip>
                    </div>
                  );
                })}
                {unusedProjects.length > 0 && (
                  <SimpleSelect
                    aria-label={tt.addProject}
                    value=""
                    placeholder={tt.addProject}
                    onValueChange={(projectId) => {
                      if (projectId) setForm({ ...form, usage: [...form.usage, { project_id: projectId, note: projectLinks.find(item => item.project_id === projectId && item.ai_link_id === form.ai_link_id)?.note ?? "" }] });
                    }}
                    options={[{ value: "", label: tt.addProject }, ...unusedProjects.map((project) => ({ value: project.id, label: project.name }))]}
                  />
                )}
              </fieldset>
              {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
              <DialogFooter className="gap-2 sm:justify-between">
                {formTool ? (
                  <Button type="button" variant="ghost" onClick={() => void removeTool(formTool)} className="text-destructive">
                    <Trash2 className="h-3.5 w-3.5" />
                    {tt.deleteTool}
                  </Button>
                ) : <span />}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setForm(null)}>{tt.cancel}</Button>
                  <Button type="submit" disabled={saving}>{tt.save}</Button>
                </div>
              </DialogFooter>
              </fieldset>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
