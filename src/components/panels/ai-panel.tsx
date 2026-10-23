"use client";

import { LinkExportDialog } from "./link-export-dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  GitMerge,
  Pencil,
  Plus,
  Search,
  Link2,
  ScanText,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { AiCategory, AiLink, AiPricing, Project, ProjectLink, Tool, Updater } from "@/lib/types";
import { linkIdsUsedByProject, nextProjectLinkOrder, projectLinkUsageByLink } from "@/lib/project-links";
import { AddToProjectDialog } from "@/components/links/add-to-project-dialog";
import { useProjectLinkMutations } from "@/components/links/use-project-links";

import { LinkLibraryCard, PricingDot } from "./link-library-card";
import { duplicateCategoryCandidates, filterLibrary, planCategoryMerge, resourceKey, UNCATEGORIZED_LINKS as UNCATEGORIZED, type PricingFilter, type LinkSort } from "@/lib/link-library";

/** Normalize a user-typed link: add https:// when no scheme is present, then
 * validate. Returns the canonical href, or null when it isn't a valid URL. */
function normalizeUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  try {
    const u = new URL(withScheme);
    if (!resourceKey(u.href)) return null;
    return u.href;
  } catch {
    return null;
  }
}

type Props = {
  aiLinks: AiLink[];
  setAiLinks: Updater<AiLink[]>;
  aiCategories: AiCategory[];
  setAiCategories: Updater<AiCategory[]>;
  projectLinks: ProjectLink[];
  setProjectLinks: Updater<ProjectLink[]>;
  projects: Project[];
  /** Tools section rows; their links carry a "Tool" badge. */
  tools?: Tool[];
  /** Open with this link's card expanded and focused (from Tools). */
  focusLinkId?: string | null;
  onFocusHandled?: () => void;
};

type LinkForm = {
  recordType: "link" | "idea";
  title: string;
  url: string;
  description: string;
  categoryId: string; // "" === Uncategorized
  pricing: "" | AiPricing; // "" === not set
};

const emptyForm: LinkForm = {
  recordType: "link",
  title: "",
  url: "",
  description: "",
  categoryId: "",
  pricing: "",
};

export function AiPanel({
  aiLinks,
  setAiLinks,
  aiCategories,
  setAiCategories,
  projectLinks,
  setProjectLinks,
  projects,
  tools = [],
  focusLinkId = null,
  onFocusHandled,
}: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();

  const [query, setQuery] = useState("");
  const [pricingFilter, setPricingFilter] = useState<PricingFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [sort, setSort] = useState<LinkSort>("name");
  const [projectFilter, setProjectFilter] = useState("all");
  const [addToProjectLink, setAddToProjectLink] = useState<AiLink | null>(null);
  const relationMutations = useProjectLinkMutations(setProjectLinks, projectLinks);
  const activeProjects = useMemo(() => projects.filter((project) => project.is_active), [projects]);
  const projectIdsWithLinks = useMemo(() => new Set(projectLinks.map((relation) => relation.project_id)), [projectLinks]);
  const projectLinkIds = useMemo(() => linkIdsUsedByProject(projectFilter, projectLinks), [projectFilter, projectLinks]);
  const toolLinkIds = useMemo(() => new Set(tools.map((tool) => tool.ai_link_id)), [tools]);
  const exportRelations = useMemo(() => ({ projectLinks, projects }), [projectLinks, projects]);
  const usageByLink = useMemo(() => projectLinkUsageByLink(projectLinks, projects), [projectLinks, projects]);
  const usedByFor = (link: AiLink) => (usageByLink.get(link.id) ?? []).map(({ project }) => ({ id: project.id, name: project.name }));
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set(focusLinkId ? [focusLinkId] : []));
  // Arriving from a Tools card: bring that link's card into view and focus
  // its disclosure. The panel mounts fresh on navigation, so the expanded
  // state above already includes it.
  useEffect(() => {
    if (!focusLinkId) return;
    const frame = window.requestAnimationFrame(() => {
      const toggle = document.querySelector<HTMLElement>(`[data-link-card="${CSS.escape(focusLinkId)}"] button[aria-controls]`);
      toggle?.scrollIntoView({ block: "center" });
      toggle?.focus();
      onFocusHandled?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusLinkId, onFocusHandled]);
  const toggleDetails = (id: string) => setExpandedIds(previous => {
    const next = new Set(previous);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const resetFilters = () => { setQuery(""); setPricingFilter("all"); setCategoryFilter("all"); setProjectFilter("all"); };
  // Tips use topic groups, but their legacy categories still need management.
  const linkRecords = useMemo(() => aiLinks.filter((link) => link.record_type !== "idea"), [aiLinks]);
  const linkCategories = aiCategories;
  const categoryCounts = useMemo(() => {
    const result = new Map<string, number>();
    for (const link of linkRecords) if (link.category_id) result.set(link.category_id, (result.get(link.category_id) ?? 0) + 1);
    return result;
  }, [linkRecords]);
  const hasUnknownPricing = linkRecords.some(link => !link.pricing);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AiLink | null>(null);
  const [form, setForm] = useState<LinkForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [newCategory, setNewCategory] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [mergeSource, setMergeSource] = useState<AiCategory | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>(UNCATEGORIZED);
  const [mergeExpectedIds, setMergeExpectedIds] = useState<string[]>([]);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const categoryIds = useMemo(
    () => new Set(aiCategories.map((c) => c.id)),
    [aiCategories],
  );

  // Filter first, then bucket the survivors by category so search collapses
  // empty sections automatically.
  const visibleLinks = useMemo(() => filterLibrary(linkRecords.filter(link => !projectLinkIds || projectLinkIds.has(link.id)), aiCategories, query, pricingFilter, categoryFilter, sort), [linkRecords, aiCategories, query, pricingFilter, categoryFilter, sort, projectLinkIds]);

  const byCategory = useMemo(() => {
    const map = new Map<string, AiLink[]>();
    for (const l of visibleLinks) {
      const key =
        l.category_id && categoryIds.has(l.category_id)
          ? l.category_id
          : UNCATEGORIZED;
      const list = map.get(key);
      if (list) list.push(l);
      else map.set(key, [l]);
    }
    return map;
  }, [visibleLinks, categoryIds]);

  const searching = query.trim().length > 0 || pricingFilter !== "all" || categoryFilter !== "all" || projectFilter !== "all";
  const uncategorized = byCategory.get(UNCATEGORIZED) ?? [];
  const isEmpty = linkRecords.length === 0 && linkCategories.length === 0;
  const noResults =
    searching && visibleLinks.length === 0 && linkRecords.length > 0;

  /* ---- link mutations ------------------------------------------------ */

  const createLink = useMutation({
    scope: { id: "library-writes" },
    mutationFn: async (vars: Omit<AiLink, "id" | "user_id" | "created_at" | "updated_at">) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("ai_links")
        .insert({ user_id: userId, ...vars })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiLink;
    },
    onSuccess: (l) => {
      setAiLinks((prev) => [l, ...prev]);
      toast.ok(l.record_type === "idea" ? t.ai.addedToTips : t.ai.linkCreated);
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
    onError: (e) => setFormError((e as Error)?.message === "no-user" ? t.ai.signInFirst : t.ai.couldNotSave),
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.aiLinks }); },
  });

  const updateLink = useMutation({
    scope: { id: "library-writes" },
    mutationFn: async (vars: {
      id: string;
      title: string;
      url: string;
      description: string | null;
      category_id: string | null;
      pricing: AiPricing | null;
      record_type: "link" | "idea";
      expectedUpdatedAt: string;
    }) => {
      const { data, error } = await supabase
        .from("ai_links")
        .update({
          title: vars.title,
          url: vars.url,
          description: vars.description,
          category_id: vars.category_id,
          pricing: vars.pricing,
          record_type: vars.record_type,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.id).eq("updated_at", vars.expectedUpdatedAt)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiLink;
    },
    onSuccess: (l) => {
      setAiLinks((prev) => prev.map((x) => (x.id === l.id ? l : x)));
      toast.ok(l.record_type === "idea" ? t.ai.movedToTips : t.ai.linkSaved);
      void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
    onError: (e) => setFormError((e as Error)?.message === "no-user" ? t.ai.signInFirst : t.ai.couldNotSave),
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.aiLinks }); },
  });

  const deleteLink = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_links").delete().eq("id", id);
      if (error) throw error;
    },
    scope: { id: "library-writes" },
    onSuccess: (_data, id) => {
      setAiLinks(old => old.filter(link => link.id !== id));
      setProjectLinks(old => old.filter(relation => relation.ai_link_id !== id));
      toast.ok(t.ai.linkDeleted);
    },
    onError: () => toast.err(t.ai.couldNotDelete),
    onSettled: () => {
      for (const queryKey of [qk.aiLinks, qk.projectLinks, qk.tools, qk.promptLinks]) void qc.invalidateQueries({ queryKey });
    },
  });

  /* ---- category mutations -------------------------------------------- */

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const sortOrder =
        Math.max(0, ...aiCategories.map((c) => c.sort_order)) + 1;
      const { data, error } = await supabase
        .from("ai_categories")
        .insert({ user_id: userId, name, sort_order: sortOrder })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as AiCategory;
    },
    onSuccess: (c) => {
      setAiCategories((prev) => [...prev, c]);
      toast.ok(t.ai.categoryCreated);
      void qc.invalidateQueries({ queryKey: qk.aiCategories });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.ai.signInFirst
          : t.ai.couldNotSave,
      ),
  });

  const renameCategory = useMutation({
    scope: { id: "library-writes" },
    mutationFn: async (vars: { id: string; name: string; previousName: string }) => {
      const { data, error } = await supabase.from("ai_categories").update({ name: vars.name })
        .eq("id", vars.id).eq("name", vars.previousName).select().single();
      if (error || !data || data.id !== vars.id || data.name !== vars.name) throw new Error("Rename not confirmed");
      return data as AiCategory;
    },
    onSuccess: category => {
      setAiCategories(rows => rows.map(row => row.id === category.id ? { ...row, name: category.name } : row));
      setRenamingId(null); setRenameValue(""); setCategoryError(null); toast.ok(t.ai.categoryRenamed);
    },
    onError: () => setCategoryError(t.ai.couldNotSave),
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.aiCategories }); },
  });

  const deleteCategory = useMutation({
    scope: { id: "library-writes" },
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("ai_categories").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      setAiCategories(rows => rows.filter(row => row.id !== id));
      setAiLinks(rows => rows.map(row => row.category_id === id ? { ...row, category_id: null } : row));
      toast.ok(t.ai.categoryDeleted);
    },
    onError: () => toast.err(t.ai.couldNotDelete),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiCategories }); void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
  });

  const mergeCategory = useMutation({
    scope: { id: "library-writes" },
    mutationFn: async (vars: { sourceId: string; sourceName: string; targetId: string | null; expectedIds: string[] }) => {
      const { data, error } = await supabase.rpc("merge_library_category", {
        p_source_id: vars.sourceId, p_target_id: vars.targetId,
        p_source_name: vars.sourceName, p_expected_link_ids: vars.expectedIds,
      });
      if (error || !data || data.source_id !== vars.sourceId || data.target_id !== vars.targetId
        || !Array.isArray(data.moved_ids) || data.moved_ids.length !== vars.expectedIds.length
        || vars.expectedIds.some(id => !data.moved_ids.includes(id))) throw new Error("Merge not confirmed");
      return vars;
    },
    onSuccess: ({ sourceId, targetId, expectedIds }) => {
      const moved = new Set(expectedIds);
      setAiLinks(rows => rows.map(row => moved.has(row.id) ? { ...row, category_id: targetId } : row));
      setAiCategories(rows => rows.filter(row => row.id !== sourceId));
      setMergeSource(null); toast.ok(t.ai.categoryMerged);
    },
    onError: () => setCategoryError(t.ai.couldNotMerge),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.aiCategories }); void qc.invalidateQueries({ queryKey: qk.aiLinks });
    },
  });

  /* ---- handlers ------------------------------------------------------ */

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(l: AiLink) {
    setEditing(l);
    setForm({
      recordType: l.record_type ?? "link",
      title: l.title,
      url: l.url,
      description: l.description ?? "",
      categoryId: l.category_id ?? "",
      pricing: l.pricing ?? "",
    });
    setFormError(null);
    setDialogOpen(true);
  }

  const saving = createLink.isPending || updateLink.isPending;

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    setFormError(null);
    const title = form.title.trim();
    if (!title) {
      setFormError(t.ai.nameRequired);
      return;
    }
    if (!form.url.trim()) {
      setFormError(t.ai.urlRequired);
      return;
    }
    const url = normalizeUrl(form.url);
    if (!url) {
      setFormError(t.ai.urlInvalid);
      return;
    }
    if (aiLinks.some(link => link.id !== editing?.id && (link.record_type ?? "link") === form.recordType && (form.recordType === "link" || link.title === title) && resourceKey(link.url) === resourceKey(url))) {
      setFormError(t.ai.duplicateLink);
      return;
    }
    const description = form.description.trim() || null;
    const category_id = form.categoryId || null;
    const pricing = form.pricing || null;
    if (editing) {
      updateLink.mutate(
        { id: editing.id, title, url, description, category_id, pricing, record_type: form.recordType, expectedUpdatedAt: editing.updated_at },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createLink.mutate(
        { title, url, description, category_id, pricing, record_type: form.recordType },
        { onSuccess: () => setDialogOpen(false) },
      );
    }
  }

  function addCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = newCategory.trim();
    if (!name) return;
    createCategory.mutate(name, { onSuccess: () => setNewCategory("") });
  }

  function commitRename() {
    if (!renamingId || renameCategory.isPending) return;
    const name = renameValue.trim();
    const cat = aiCategories.find(c => c.id === renamingId);
    if (!name || !cat) return;
    if (name === cat.name) { setRenamingId(null); return; }
    setCategoryError(null);
    renameCategory.mutate({ id: renamingId, name, previousName: cat.name });
  }

  // Name pairs that read as one topic. A suggestion for the merge dialog, never
  // an automatic move: only the owner knows whether two similar names are one
  // category or a distinction worth keeping.
  const duplicateCategories = useMemo(() => duplicateCategoryCandidates(aiCategories), [aiCategories]);

  function suggestedMergeTarget(source: AiCategory): string | null {
    const pair = duplicateCategories.find(([keep, duplicate]) => keep.id === source.id || duplicate.id === source.id);
    if (!pair) return null;
    return pair[0].id === source.id ? pair[1].id : pair[0].id;
  }

  function openMerge(category: AiCategory) {
    setCategoryError(null);
    setMergeExpectedIds(planCategoryMerge(aiLinks, category.id, null));
    setMergeSource(category);
    setMergeTargetId(
      suggestedMergeTarget(category)
      ?? aiCategories.find((c) => c.id !== category.id)?.id
      ?? UNCATEGORIZED,
    );
  }

  function submitMerge(e: React.FormEvent) {
    e.preventDefault();
    if (!mergeSource || mergeCategory.isPending) return;
    setCategoryError(null);
    mergeCategory.mutate({ sourceId: mergeSource.id, sourceName: mergeSource.name,
      targetId: mergeTargetId === UNCATEGORIZED ? null : mergeTargetId, expectedIds: mergeExpectedIds });
  }

  async function removeCategory(c: AiCategory) {
    if (await confirm({
      title: t.ai.deleteCategory,
      description: t.ai.deleteCategoryConfirm(c.name),
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteCategory.mutate(c.id);
  }

  async function removeLink(l: AiLink) {
    if (await confirm({
      title: t.common.delete,
      description: t.ai.deleteLinkConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteLink.mutate(l.id);
  }

  /* ---- render -------------------------------------------------------- */

  return (
    <div>
      <PageHeader
        title={t.ai.title}
        description={t.ai.description}
        action={
          <div className="flex flex-wrap gap-2">
          <LinkExportDialog links={aiLinks} categories={aiCategories} scope="link" relations={exportRelations} />
          <Button size="sm" onClick={() => openCreate() }>
            <Plus className="h-3.5 w-3.5" />
            {t.ai.addLink}
          </Button>
          </div>
        }
      />

      <div aria-label={t.ai.pricingLegend} className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-foreground-muted">
        <span className="font-medium">{t.ai.pricingLegend}</span>
        {(["free", "freemium", "paid"] as const).map(pricing => <span key={pricing} className="inline-flex items-center gap-1.5"><PricingDot pricing={pricing} />{t.ai.pricingLabel[pricing]}</span>)}
        {hasUnknownPricing && <span className="inline-flex items-center gap-1.5"><PricingDot pricing={null} />{t.ai.pricingUnknown}</span>}
      </div>
      {isEmpty ? (
        <Card className="p-0">
          <EmptyState
            icon={Link2}
            title={t.ai.noLinksYet}
            description={t.ai.noLinksDescription}
            action={
              <Button size="sm" onClick={() => openCreate() }>
                <Plus className="h-3.5 w-3.5" />
                {t.ai.addLink}
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : (
        <>
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-[minmax(12rem,1fr)_minmax(10rem,1fr)_auto_auto_auto]">
            <div className="relative min-w-0">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
              <Input aria-label={t.ai.searchPlaceholder} placeholder={t.ai.searchPlaceholder} value={query} onChange={e => setQuery(e.target.value)} className="pl-8" />
            </div>
            <SimpleSelect aria-label={t.ai.category} value={categoryFilter} onValueChange={setCategoryFilter} options={[{value:"all",label:t.ai.allCategories}, ...linkCategories.map(cat => ({value:cat.id,label:`${cat.name} (${categoryCounts.get(cat.id) ?? 0})`})), {value:UNCATEGORIZED,label:t.ai.uncategorized}]} />
            <SimpleSelect aria-label={t.ai.pricing} value={pricingFilter} onValueChange={value => setPricingFilter(value as PricingFilter)} options={[{value:"all",label:t.ai.allPricing}, ...(["free","freemium","paid"] as const).map(value => ({value,label:t.ai.pricingLabel[value]})), {value:"unknown",label:t.ai.pricingUnknown}]} />
            <SimpleSelect aria-label={t.ai.sort} value={sort} onValueChange={value => setSort(value as LinkSort)} options={[{value:"name",label:t.ai.sortName},{value:"newest",label:t.ai.sortNewest}]} />
            {projectIdsWithLinks.size > 0 && <SimpleSelect aria-label={t.ai.projectFilterLabel} value={projectFilter} onValueChange={setProjectFilter} options={[{value:"all",label:t.ai.allProjects}, ...projects.filter(project => projectIdsWithLinks.has(project.id)).map(project => ({value:project.id,label:project.name}))]} />}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p role="status" className="text-xs text-foreground-muted">{t.ai.resultCount(visibleLinks.length, linkRecords.length)}</p>
            <div className="flex flex-wrap gap-2">
              {searching && <Button variant="ghost" size="sm" onClick={resetFilters}>{t.ai.clearFilters}</Button>}
              <Button variant="outline" size="sm" onClick={() => setExpandedIds(new Set(visibleLinks.map(link => link.id)))} disabled={!visibleLinks.length}>{t.ai.expandAll}</Button>
              <Button variant="outline" size="sm" onClick={() => setExpandedIds(new Set())} disabled={!expandedIds.size}>{t.ai.collapseAll}</Button>
            </div>
          </div>
          {categoryError && !mergeSource && <p role="alert" className="mb-3 text-xs text-risk">{categoryError}</p>}
          <details className="mb-4 rounded-lg border border-border bg-surface px-3">
            <summary className="focus-ring cursor-pointer py-3 text-xs font-medium">{t.ai.manageCategories}</summary>
            <form onSubmit={addCategory} className="flex max-w-md items-center gap-2 pb-3">
              <Input disabled={createCategory.isPending} aria-label={t.ai.addCategory} value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder={t.ai.addCategoryPlaceholder} className="min-w-0 flex-1" maxLength={40} />
              <Button type="submit" variant="outline" size="sm" disabled={!newCategory.trim() || createCategory.isPending}><Plus className="h-3.5 w-3.5" />{t.ai.add}</Button>
            </form>
            <p className="pb-3 text-xs text-foreground-muted">{t.ai.manageHint}</p>
            {duplicateCategories.length > 0 && (
              <p className="pb-3 text-xs text-foreground-muted">
                {t.ai.duplicateCategoryHint(duplicateCategories.map(([keep, duplicate]) => `${keep.name} / ${duplicate.name}`).join(", "))}
              </p>
            )}
          </details>

          {noResults ? (
            <EmptyState
              icon={Search}
              title={t.ai.noMatches}
              description={t.ai.noMatchesDescription}
              className="py-16"
            />
          ) : (
            <div className="columns-1 gap-4 lg:columns-2 2xl:columns-3">
              {linkCategories.map((cat) => {
                  const links = byCategory.get(cat.id) ?? [];
                  // While searching, hide categories that have no matches.
                  if ((links.length === 0 && searching) || (categoryFilter !== "all" && categoryFilter !== cat.id)) return null;
                  return (
                    <CategoryGroup
                      key={cat.id}
                      name={cat.name}
                      count={links.length}
                      renaming={renamingId === cat.id}
                      renameValue={renameValue}
                      onRenameChange={setRenameValue}
                      onStartRename={() => {
                        setCategoryError(null);
                        setRenamingId(cat.id);
                        setRenameValue(cat.name);
                      }}
                      onCommitRename={commitRename}
                      onCancelRename={() => {
                        setRenamingId(null);
                        setRenameValue("");
                      }}
                      onDelete={() => removeCategory(cat)}
                      onMerge={() => openMerge(cat)}
                      mergeSuggested={suggestedMergeTarget(cat) !== null}
                      pending={renameCategory.isPending || deleteCategory.isPending || mergeCategory.isPending}
                    >
                      {links.length === 0 ? (
                        <EmptyRow text={t.ai.categoryEmpty} />
                      ) : (
                        links.map((l) => (
                          <LinkLibraryCard
                            key={l.id}
                            link={l}
                            expanded={expandedIds.has(l.id)}
                            onToggle={() => toggleDetails(l.id)}
                            onEdit={() => openEdit(l)}
                            onDelete={() => removeLink(l)}
                            usedBy={usedByFor(l)}
                            isTool={toolLinkIds.has(l.id)}
                            onAddToProject={() => setAddToProjectLink(l)}
                          />
                        ))
                      )}
                    </CategoryGroup>
                  );
                })}

                {uncategorized.length > 0 && (
                  <CategoryGroup name={t.ai.uncategorized} count={uncategorized.length} muted>
                    {uncategorized.map((l) => (
                      <LinkLibraryCard
                        key={l.id}
                        link={l}
                        expanded={expandedIds.has(l.id)}
                        onToggle={() => toggleDetails(l.id)}
                        onEdit={() => openEdit(l)}
                        onDelete={() => removeLink(l)}
                        usedBy={usedByFor(l)}
                        isTool={toolLinkIds.has(l.id)}
                        onAddToProject={() => setAddToProjectLink(l)}
                      />
                    ))}
                  </CategoryGroup>
                )}
            </div>
          )}
        </>
      )}

      <AddToProjectDialog
        open={addToProjectLink !== null}
        onOpenChange={(open) => !open && setAddToProjectLink(null)}
        linkTitle={addToProjectLink?.title ?? ""}
        projects={addToProjectLink ? activeProjects.filter((project) => !projectLinks.some((relation) => relation.project_id === project.id && relation.ai_link_id === addToProjectLink.id)) : []}
        onSave={async ({ projectId, role, note }) => {
          if (!addToProjectLink) return false;
          const saved = await relationMutations.upsert([{
            project_id: projectId,
            ai_link_id: addToProjectLink.id,
            role,
            note,
            sort_order: nextProjectLinkOrder(projectId, projectLinks),
          }], { silent: true });
          return saved !== null;
        }}
      />

      <MergeCategoryDialog
        source={mergeSource}
        onClose={() => setMergeSource(null)}
        categories={aiCategories}
        targetId={mergeTargetId}
        setTargetId={setMergeTargetId}
        suggestedTargetId={mergeSource ? suggestedMergeTarget(mergeSource) : null}
        movingCount={mergeExpectedIds.length}
        error={categoryError}
        merging={mergeCategory.isPending}
        onSubmit={submitMerge}
      />

      {dialogOpen && <LinkDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing !== null}
        form={form}
        setForm={setForm}
        categories={aiCategories}
        error={formError}
        saving={saving}
        onSubmit={submitForm}
      />}
    </div>
  );
}

/* ---------------------------------------------------------------------- */

function CategoryGroup({
  name,
  count,
  muted,
  renaming,
  renameValue,
  onRenameChange,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onDelete,
  onMerge,
  mergeSuggested,
  pending = false,
  children,
}: {
  name: string;
  count: number;
  muted?: boolean;
  renaming?: boolean;
  renameValue?: string;
  onRenameChange?: (v: string) => void;
  onStartRename?: () => void;
  onCommitRename?: () => void;
  onCancelRename?: () => void;
  onDelete?: () => void;
  onMerge?: () => void;
  /** This category's name reads the same as another one's, so merging is offered first. */
  mergeSuggested?: boolean;
  pending?: boolean;
  children: React.ReactNode;
}) {
  const t = useDict();
  return (
    <Card className="mb-4 inline-flex w-full break-inside-avoid flex-col overflow-hidden p-0 align-top">
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted/40 px-3 py-2">
        {renaming ? (
          <input
            disabled={pending}
            autoFocus
            aria-label={`${t.ai.renameCategory}: ${name}`}
            value={renameValue}
            onChange={(e) => onRenameChange?.(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommitRename?.();
              } else if (e.key === "Escape") {
                e.preventDefault();
                onCancelRename?.();
              }
            }}
            maxLength={40}
            className="h-11 min-w-0 flex-1 sm:h-7 rounded border border-border bg-surface px-1.5 text-[11px] font-semibold uppercase tracking-wider text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        ) : (
          <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
            {name}
          </span>
        )}
        {renaming && <Button type="button" size="sm" variant="outline" disabled={pending} onClick={onCommitRename}>{t.ai.save}</Button>}
        <span className="text-[10px] tabular text-foreground-subtle">
          {count}
        </span>
        {!muted && !renaming && (
          <div className="ml-auto flex items-center gap-0.5">
            <Tooltip content={t.ai.renameCategory}>
              <button
                disabled={pending}
                type="button"
                onClick={onStartRename}
                aria-label={`${t.ai.renameCategory}: ${name}`}
                className="inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
              >
                <Pencil className="h-3 w-3" />
              </button>
            </Tooltip>
            {onMerge && (
              <Tooltip content={mergeSuggested ? `${t.ai.mergeCategory} · ${t.ai.suggestedMerge}` : t.ai.mergeCategory}>
                <button
                  disabled={pending}
                  type="button"
                  onClick={onMerge}
                  aria-label={`${t.ai.mergeCategory}: ${name}`}
                  className={cn(
                    "inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded transition-colors hover:bg-surface-hover hover:text-foreground focus-ring",
                    mergeSuggested ? "text-warning" : "text-foreground-subtle",
                  )}
                >
                  <GitMerge className="h-3 w-3" />
                </button>
              </Tooltip>
            )}
            <Tooltip content={t.ai.deleteCategory}>
              <button
                disabled={pending}
                type="button"
                onClick={onDelete}
                aria-label={`${t.ai.deleteCategory}: ${name}`}
                className="inline-flex h-11 w-11 sm:h-7 sm:w-7 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </Tooltip>
          </div>
        )}
      </div>
      <div className="divide-y divide-border/60">{children}</div>
    </Card>
  );
}

/**
 * Collapse one category into another. The destination list is every other
 * category plus Uncategorized, so a category can always be emptied even when it
 * is the only one left. The count under the select is what will actually move,
 * recomputed from the same pure planner the mutation uses.
 */
function MergeCategoryDialog({
  source,
  onClose,
  categories,
  targetId,
  setTargetId,
  suggestedTargetId,
  movingCount,
  error,
  merging,
  onSubmit,
}: {
  source: AiCategory | null;
  onClose: () => void;
  categories: AiCategory[];
  targetId: string;
  setTargetId: (value: string) => void;
  suggestedTargetId: string | null;
  movingCount: number;
  error: string | null;
  merging: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useDict();
  const targetName =
    targetId === UNCATEGORIZED
      ? t.ai.uncategorized
      : categories.find((c) => c.id === targetId)?.name ?? t.ai.uncategorized;
  return (
    <Dialog open={source !== null} onOpenChange={(open) => { if (!open && !merging) onClose(); }}>
      <DialogContent showClose={!merging} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t.ai.mergeCategoryTitle(source?.name ?? "")}</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
        <fieldset disabled={merging} className="mt-3 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ai-merge-target">{t.ai.mergeCategoryInto}</Label>
            <SimpleSelect
              id="ai-merge-target"
              value={targetId}
              onValueChange={setTargetId}
              options={[
                ...categories
                  .filter((c) => c.id !== source?.id)
                  .map((c) => ({ value: c.id, label: c.id === suggestedTargetId ? `${c.name} · ${t.ai.suggestedMerge}` : c.name })),
                { value: UNCATEGORIZED, label: t.ai.uncategorized },
              ]}
            />
            <p className="text-xs text-foreground-muted">{t.ai.mergeCategoryRecords(movingCount)}</p>
          </div>
          <p className="text-xs text-foreground-muted">{t.ai.mergeCategoryConfirm(source?.name ?? "", targetName)}</p>
          {error && <p role="alert" className="text-xs text-risk">{error}</p>}
          <div className="flex items-center justify-end gap-2 pt-1">
            <DialogClose asChild>
              <Button type="button" variant="ghost" size="sm">{t.ai.cancel}</Button>
            </DialogClose>
            <Button type="submit" size="sm" disabled={merging}>
              <GitMerge className="h-3.5 w-3.5" />
              {merging ? t.ai.saving : t.ai.mergeCategoryAction}
            </Button>
          </div>
        </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyRow({ text }: { text: string }) {
  return (
    <p className="px-3 py-2.5 text-xs italic text-foreground-subtle">{text}</p>
  );
}

function LinkDialog({
  open,
  onOpenChange,
  editing,
  form,
  setForm,
  categories,
  error,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: boolean;
  form: LinkForm;
  setForm: React.Dispatch<React.SetStateAction<LinkForm>>;
  categories: AiCategory[];
  error: string | null;
  saving: boolean;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const t = useDict();
  const [enriching, setEnriching] = useState(false);
  const [enrichMsg, setEnrichMsg] = useState<string | null>(null);

  const enrichRequest = useRef<AbortController | null>(null);
  useEffect(() => () => enrichRequest.current?.abort(), []);

  // Only the submitted URL goes to Jina. A late response may fill unchanged
  // fields of this document, never overwrite newer edits or another dialog.
  async function autoFill() {
    if (enrichRequest.current) return;
    const snapshot = form;
    const url = normalizeUrl(form.url);
    if (!url) {
      setEnrichMsg(t.ai.enrichNeedsUrl);
      return;
    }
    const controller = new AbortController();
    enrichRequest.current = controller;
    setEnriching(true);
    setEnrichMsg(null);
    try {
      const res = await fetch("/api/ai-links/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      });
      const data: unknown = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok || !data || typeof data !== "object" || !("title" in data) || typeof data.title !== "string"
        || !("description" in data) || typeof data.description !== "string") {
        setEnrichMsg(t.ai.enrichFailed); return;
      }
      const title = data.title.slice(0, 120), description = data.description.slice(0, 10_000);
      setForm(current => current.url !== snapshot.url ? current : ({
        ...current,
        title: current.title === snapshot.title && !current.title.trim() ? title : current.title,
        description: current.description === snapshot.description && description ? description : current.description,
      }));
    } catch {
      if (!controller.signal.aborted) setEnrichMsg(t.ai.enrichFailed);
    } finally {
      enrichRequest.current = null;
      setEnriching(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) onOpenChange(next); }}>
      <DialogContent showClose={!saving} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {editing ? t.ai.editLinkTitle : t.ai.newLinkTitle}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <fieldset disabled={saving} className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ai-name">{t.ai.name}</Label>
              <Input
                required
                id="ai-name"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({ ...f, title: e.target.value }))
                }
                placeholder={t.ai.namePlaceholder}
                autoFocus
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-record-type">{t.ai.recordType}</Label>
              <SimpleSelect id="ai-record-type" aria-describedby={form.recordType === "idea" ? "ai-record-type-hint" : undefined} value={form.recordType} onValueChange={(v) => setForm((f) => ({ ...f, recordType: v as LinkForm["recordType"] }))} options={[{ value: "link", label: t.ai.linkType }, { value: "idea", label: t.ai.ideaType }]} />
              {form.recordType === "idea" && <p id="ai-record-type-hint" className="text-[11px] text-foreground-subtle">{t.ai.ideaTypeHint}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-url">{t.ai.url}</Label>
              <div className="flex items-center gap-2">
                <Input
                  required
                  maxLength={4096}
                  id="ai-url"
                  value={form.url}
                  onChange={(e) => {
                    setForm((f) => ({ ...f, url: e.target.value }));
                    if (enrichMsg) setEnrichMsg(null);
                  }}
                  placeholder={t.ai.urlPlaceholder}
                  inputMode="url"
                  className="flex-1"
                />
                <Tooltip content={t.ai.autoFillHint}>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={autoFill}
                    disabled={enriching || !form.url.trim()}
                    className="shrink-0"
                  >
                    <ScanText className="h-3.5 w-3.5" />
                    {enriching ? t.ai.enriching : t.ai.autoFill}
                  </Button>
                </Tooltip>
              </div>
              {enrichMsg && (
                <p role="status" className="text-xs text-foreground-muted">{enrichMsg}</p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ai-category">{t.ai.category}</Label>
                <SimpleSelect
                  id="ai-category"
                  value={form.categoryId}
                  onValueChange={(v) =>
                    setForm((f) => ({ ...f, categoryId: v }))
                  }
                  options={[
                    { value: "", label: t.ai.uncategorized },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ai-pricing">{t.ai.pricing}</Label>
                <SimpleSelect
                  id="ai-pricing"
                  value={form.pricing}
                  onValueChange={(v) =>
                    setForm((f) => ({
                      ...f,
                      pricing: v as LinkForm["pricing"],
                    }))
                  }
                  options={[
                    { value: "", label: t.ai.pricingNone },
                    { value: "free", label: t.ai.pricingLabel.free },
                    { value: "freemium", label: t.ai.pricingLabel.freemium },
                    { value: "paid", label: t.ai.pricingLabel.paid },
                  ]}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ai-description">{t.ai.descriptionLabel}</Label>
              <Textarea
                maxLength={10000}
                id="ai-description"
                value={form.description}
                onChange={(e) =>
                  setForm((f) => ({ ...f, description: e.target.value }))
                }
                placeholder={t.ai.descriptionPlaceholder}
                rows={3}
              />
            </div>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.ai.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={saving || enriching}>
                <Check className="h-3.5 w-3.5" />
                {saving ? t.ai.saving : editing ? t.ai.save : t.ai.create}
              </Button>
            </div>
          </fieldset>
          </form>
        </DialogContent>
    </Dialog>
  );
}
