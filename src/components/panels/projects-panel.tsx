"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  ChevronDown,
  Clock,
  ExternalLink,
  FolderKanban,
  GripVertical,
  Pencil,
  Plus,
  Power,
  Cpu,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { EntityBadge, StatusBadge } from "@/components/ui/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { GithubIcon } from "@/components/icons/github";
import { ProjectNotesEditor } from "@/components/projects/project-notes-editor";
import { ProjectWorkspace } from "@/components/projects/project-workspace";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { cn, formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { CHART_COLORS } from "@/lib/chart-colors";
import { qk } from "@/lib/queries/keys";
import { useReposQuery } from "@/lib/github-queries";
import {
  readRepoFilter,
} from "@/lib/use-prefs";
import { cronSeedsForRepo } from "@/lib/project-cron-seeds";
import { assessProjectHealth, type ProjectHealth } from "@/lib/project-health";
import type { GithubRepo } from "@/lib/github";
import {
  costMonthlyIn,
  cronMonthlyIn,
  cronsMonthlyIn,
  costsMonthlyIn,
  projectMonthlyIn,
} from "@/lib/projects";
import type {
  ClientOpportunity,
  Cron,
  ImportantDate,
  InboxItem,
  Invoice,
  InvoiceItem,
  Note,
  Organization,
  Project,
  ProjectCommunication,
  ProjectCost,
  Prompt,
  RepoLink,
  RepoNote,
  Subscription,
  Todo,
  Transaction,
  Updater,
} from "@/lib/types";

const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type ProjectForm = {
  id?: string;
  name: string;
  slug: string;
  repo_full_name: string;
  url: string;
  dev_url: string;
};

const emptyProjectForm: ProjectForm = {
  name: "",
  slug: "",
  repo_full_name: "",
  url: "",
  dev_url: "",
};

type ProjectsPanelProps = {
  projects: Project[];
  setProjects: Updater<Project[]>;
  costs: ProjectCost[];
  setCosts: Updater<ProjectCost[]>;
  crons: Cron[];
  setCrons: Updater<Cron[]>;
  displayCurrency: string;
  setDisplayCurrency?: (next: string) => void;
  initialVisibleIds?: string[];
  selectedProjectId?: string;
  onOpenProject: (project: Project) => void;
  onBackToProjects: () => void;
  todos: Todo[];
  notes: Note[];
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  subscriptions: Subscription[];
  transactions: Transaction[];
  organizations: Organization[];
  opportunities: ClientOpportunity[];
  importantDates: ImportantDate[];
  prompts: Prompt[];
  inboxItems: InboxItem[];
  repoNotes: RepoNote[];
  setRepoNotes: Updater<RepoNote[]>;
  repoLinks: RepoLink[];
  setRepoLinks: Updater<RepoLink[]>;
  communications: ProjectCommunication[];
  setCommunications: Updater<ProjectCommunication[]>;
  syncRepositories?: boolean;
};

export function ProjectsPanel(props: ProjectsPanelProps) {
  const selected = props.selectedProjectId
    ? props.projects.find((project) => project.id === props.selectedProjectId)
    : null;
  if (selected) {
    return <ProjectWorkspace
      project={selected}
      costs={props.costs.filter((item) => item.project_id === selected.id)}
      crons={props.crons.filter((item) => item.project_id === selected.id)}
      todos={props.todos}
      notes={props.notes}
      invoices={props.invoices}
      invoiceItems={props.invoiceItems}
      subscriptions={props.subscriptions}
      transactions={props.transactions}
      organizations={props.organizations}
      opportunities={props.opportunities}
      importantDates={props.importantDates}
      prompts={props.prompts}
      inboxItems={props.inboxItems}
      repoNotes={props.repoNotes}
      setRepoNotes={props.setRepoNotes}
      repoLinks={props.repoLinks}
      setRepoLinks={props.setRepoLinks}
      communications={props.communications}
      setCommunications={props.setCommunications}
      displayCurrency={props.displayCurrency}
      repositoryIntegrationEnabled={props.syncRepositories !== false}
      onBackToProjects={props.onBackToProjects}
    />;
  }
  return <ProjectsListPanel {...props} />;
}

function ProjectsListPanel({
  projects,
  setProjects,
  costs,
  setCosts,
  crons,
  setCrons,
  displayCurrency,
  setDisplayCurrency,
  initialVisibleIds = [],
  syncRepositories = true,
  todos,
  organizations,
  importantDates,
  onOpenProject,
}: ProjectsPanelProps) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();
  const [form, setForm] = useState<ProjectForm>(emptyProjectForm);
  const [formOpen, setFormOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [manageProjectId, setManageProjectId] = useState<string | null>(null);

  // --- Sync active Repositories → Projects -------------------------------
  // The active repos are the shared Repositories allow-list applied to the live
  // repo list (empty allow-list = all repos) — the same set the Repositories
  // and Costs sections show. Every active repo automatically gets a project so
  // it can carry costs, crons and notes. Removing a repo from the allow-list
  // leaves its project (and data) in place — we only ever add, never delete.
  const { data: reposData } = useReposQuery(syncRepositories);
  const [visibleIds] = useState<string[]>(
    () => readRepoFilter() ?? initialVisibleIds,
  );
  const activeRepos = useMemo<GithubRepo[]>(() => {
    const repos = reposData?.kind === "ok" ? reposData.repos : [];
    if (visibleIds.length === 0) return repos;
    const set = new Set(visibleIds);
    return repos.filter((r) => set.has(String(r.id)));
  }, [reposData, visibleIds]);

  // repo_full_name (lowercased) of every project that already has one, so we can
  // tell which active repos still need a project — and flag synced project cards.
  const projectRepoNames = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) {
      if (p.repo_full_name) set.add(p.repo_full_name.toLowerCase());
    }
    return set;
  }, [projects]);

  // Full names of the currently-active repos, so a card can show it is synced
  // from GitHub (rather than being a manually added project).
  const activeRepoNames = useMemo(
    () => new Set(activeRepos.map((r) => r.full_name.toLowerCase())),
    [activeRepos],
  );

  // Guard rails so the sync effect never double-inserts across re-renders /
  // StrictMode: repo full names we've started creating, and project ids we've
  // already seeded crons for this mount.
  const creatingRepos = useRef<Set<string>>(new Set());
  const seededProjectIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function seedCronsFor(project: Project) {
      const seeds = cronSeedsForRepo(project.repo_full_name);
      if (seeds.length === 0 || seededProjectIds.current.has(project.id)) return;
      seededProjectIds.current.add(project.id);
      const userId = await currentUserId(supabase);
      if (!userId) return;
      const rows = seeds.map((s) => ({
        user_id: userId,
        project_id: project.id,
        name: s.name,
        schedule: s.schedule,
        endpoint: s.endpoint,
        description: s.description,
        is_ai_call: s.is_ai_call,
        cost_per_run: 0,
        currency: displayCurrency,
        runs_per_month: s.runs_per_month,
        enabled: true,
      }));
      const { data, error } = await supabase.from("crons").insert(rows).select();
      if (error || !data) {
        seededProjectIds.current.delete(project.id);
        return;
      }
      if (!cancelled) setCrons((prev) => [...prev, ...(data as Cron[])]);
    }

    async function sync() {
      // Backfill crons for repos whose project already exists but is still
      // cron-less (e.g. it was created before its workflows were known).
      for (const repo of activeRepos) {
        const match = projects.find(
          (p) =>
            p.repo_full_name?.toLowerCase() === repo.full_name.toLowerCase(),
        );
        if (
          match &&
          cronSeedsForRepo(repo.full_name).length > 0 &&
          !crons.some((c) => c.project_id === match.id) &&
          !seededProjectIds.current.has(match.id)
        ) {
          await seedCronsFor(match);
        }
      }

      // Create a project for each active repo that doesn't have one yet.
      const missing = activeRepos.filter(
        (r) =>
          !projectRepoNames.has(r.full_name.toLowerCase()) &&
          !creatingRepos.current.has(r.full_name.toLowerCase()),
      );
      if (missing.length === 0) return;

      const userId = await currentUserId(supabase);
      if (!userId) return;

      // Allocate unique slugs against existing ones and within this batch.
      const usedSlugs = new Set(projects.map((p) => p.slug));
      let sortBase = projects.length;

      for (const repo of missing) {
        const key = repo.full_name.toLowerCase();
        creatingRepos.current.add(key);
        let slug = slugify(repo.name) || slugify(repo.full_name) || "project";
        if (usedSlugs.has(slug)) {
          let n = 2;
          while (usedSlugs.has(`${slug}-${n}`)) n++;
          slug = `${slug}-${n}`;
        }
        usedSlugs.add(slug);
        try {
          const { data, error } = await supabase
            .from("projects")
            .insert({
              user_id: userId,
              name: repo.name,
              slug,
              repo_full_name: repo.full_name,
              url: null,
              sort_order: sortBase++,
              is_active: true,
            })
            .select()
            .single();
          if (error || !data) {
            // A concurrent create (another tab/device) may have won the slug —
            // let the query reconcile instead of surfacing an error.
            creatingRepos.current.delete(key);
            continue;
          }
          const created = data as Project;
          if (!cancelled) setProjects((prev) => [...prev, created]);
          await seedCronsFor(created);
        } catch {
          creatingRepos.current.delete(key);
        }
      }
      if (!cancelled) void qc.invalidateQueries({ queryKey: qk.projects });
    }

    void sync();
    return () => {
      cancelled = true;
    };
    // Re-run when the active repo set or the existing projects change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRepos, projectRepoNames]);

  const costsByProject = useMemo(() => {
    const map = new Map<string, ProjectCost[]>();
    for (const c of costs) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [costs]);

  const cronsByProject = useMemo(() => {
    const map = new Map<string, Cron[]>();
    for (const c of crons) {
      const arr = map.get(c.project_id);
      if (arr) arr.push(c);
      else map.set(c.project_id, [c]);
    }
    return map;
  }, [crons]);

  const active = projects.filter((p) => p.is_active);

  // Manual order — the card list is driven purely by sort_order (drag updates
  // it), with created_at as a stable tie-breaker for equal orders.
  const ordered = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.created_at.localeCompare(b.created_at),
      ),
    [projects],
  );

  // Drag-to-reorder. sort_order is an integer column, so we resequence the
  // whole list to 0..n-1 on drop (no fractional indexing) and persist the rows
  // that actually moved. Optimistic, with a snapshot rollback on failure.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  async function handleDragEnd(e: DragEndEvent) {
    if (!e.over || e.active.id === e.over.id) return;
    const oldIndex = ordered.findIndex((p) => p.id === e.active.id);
    const newIndex = ordered.findIndex((p) => p.id === e.over!.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const resequenced = arrayMove(ordered, oldIndex, newIndex);
    const orderById = new Map(resequenced.map((p, i) => [p.id, i]));
    const changed = resequenced.filter((p, i) => p.sort_order !== i);
    if (changed.length === 0) return;

    const snapshot = projects;
    setProjects((prev) =>
      prev.map((p) =>
        orderById.has(p.id) ? { ...p, sort_order: orderById.get(p.id)! } : p,
      ),
    );
    try {
      const now = new Date().toISOString();
      const results = await Promise.all(
        changed.map((p) =>
          supabase
            .from("projects")
            .update({ sort_order: orderById.get(p.id)!, updated_at: now })
            .eq("id", p.id),
        ),
      );
      const failed = results.find((r) => r.error);
      if (failed?.error) throw failed.error;
      void qc.invalidateQueries({ queryKey: qk.projects });
    } catch (err) {
      setProjects(snapshot);
      toast.err((err as Error).message);
    }
  }

  const chartData = useMemo(
    () =>
      active
        .map((p) => ({
          name: p.name,
          value: Number(
            projectMonthlyIn(
              costsByProject.get(p.id) ?? [],
              cronsByProject.get(p.id) ?? [],
              displayCurrency,
            ).toFixed(2),
          ),
        }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value),
    [active, costsByProject, cronsByProject, displayCurrency],
  );

  const grandMonthly = useMemo(
    () =>
      active.reduce(
        (acc, p) =>
          acc +
          projectMonthlyIn(
            costsByProject.get(p.id) ?? [],
            cronsByProject.get(p.id) ?? [],
            displayCurrency,
          ),
        0,
      ),
    [active, costsByProject, cronsByProject, displayCurrency],
  );
  const grandYearly = grandMonthly * 12;

  async function submitProject(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) return setError(t.projects.nameRequired);
    const slug = slugify(form.slug || form.name);
    if (!slug) return setError(t.projects.slugRequired);
    const payload = {
      name: form.name.trim(),
      slug,
      repo_full_name: form.repo_full_name.trim() || null,
      url: form.url.trim() || null,
      dev_url: form.dev_url.trim() || null,
    };
    setSaving(true);
    try {
      if (form.id) {
        const { data, error } = await supabase
          .from("projects")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", form.id)
          .select()
          .single();
        if (error) throw error;
        setProjects((prev) =>
          prev.map((p) => (p.id === form.id ? (data as Project) : p)),
        );
      } else {
        const userId = await currentUserId(supabase);
        if (!userId) throw new Error(t.quickAdd.signInFirst);
        const { data, error } = await supabase
          .from("projects")
          .insert({ ...payload, user_id: userId, sort_order: projects.length })
          .select()
          .single();
        if (error) throw error;
        setProjects((prev) => [...prev, data as Project]);
      }
      setForm(emptyProjectForm);
      setFormOpen(false);
      void qc.invalidateQueries({ queryKey: qk.projects });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function openNewProject() {
    setForm(emptyProjectForm);
    setError(null);
    setFormOpen(true);
  }

  async function toggleProjectActive(p: Project) {
    const next = !p.is_active;
    setProjects((prev) =>
      prev.map((x) => (x.id === p.id ? { ...x, is_active: next } : x)),
    );
    const { error } = await supabase
      .from("projects")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) {
      setProjects((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, is_active: !next } : x)),
      );
      toast.err(error.message);
    }
  }

  async function deleteProject(p: Project) {
    if (!await confirm({
      title: t.projects.deleteProject,
      description: t.projects.deleteProjectConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error } = await supabase.from("projects").delete().eq("id", p.id);
    if (error) return toast.err(error.message);
    setProjects((prev) => prev.filter((x) => x.id !== p.id));
    // Costs and crons cascade-delete in the DB; drop them from the cache too.
    setCosts((prev) => prev.filter((c) => c.project_id !== p.id));
    setCrons((prev) => prev.filter((c) => c.project_id !== p.id));
    if (form.id === p.id) setForm(emptyProjectForm);
    void qc.invalidateQueries({ queryKey: qk.projects });
  }

  function startEditProject(p: Project) {
    setForm({
      id: p.id,
      name: p.name,
      slug: p.slug,
      repo_full_name: p.repo_full_name ?? "",
      url: p.url ?? "",
      dev_url: p.dev_url ?? "",
    });
    setError(null);
    setFormOpen(true);
  }

  return (
    <div>
      <PageHeader
        title={t.projects.title}
        description={t.projects.description}
        action={
          <div className="inline-flex items-center gap-2">
            {setDisplayCurrency && (
              <>
                <Label className="hidden text-foreground-subtle sm:inline">
                  {t.projects.displayIn}
                </Label>
                <SimpleSelect
                  value={displayCurrency}
                  onValueChange={(v) => setDisplayCurrency(v)}
                  aria-label={t.projects.displayIn}
                  className="h-8 w-20 text-xs"
                  options={SUPPORTED_CURRENCIES.map((c) => ({
                    value: c,
                    label: c,
                  }))}
                />
              </>
            )}
            <Button size="sm" onClick={openNewProject}>
              <Plus className="h-3.5 w-3.5" />
              {t.projects.addProject}
            </Button>
          </div>
        }
      />

      {/* Totals + chart (full width — the form now lives in a dialog) */}
      {chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t.projects.allProjectsMonthly}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid items-center gap-6 sm:grid-cols-2">
              <div className="h-48 sm:h-56">
                <CategoryDonut
                  data={chartData}
                  currency={displayCurrency}
                  innerRadius={56}
                  outerRadius={92}
                />
              </div>
              <div>
                <p className="text-3xl font-semibold tracking-tight tabular">
                  {formatCurrency(grandMonthly, displayCurrency)}
                </p>
                <p className="text-xs text-foreground-subtle">
                  {t.projects.grandTotalMonthly.toLowerCase()} ·{" "}
                  {t.projects.activeProjects(active.length)}
                </p>
                <p className="text-xs text-foreground-subtle mt-1 tabular">
                  {t.projects.perYr(
                    formatCurrency(grandYearly, displayCurrency),
                  )}
                </p>
                <ul className="mt-4 space-y-1.5">
                  {chartData.map((d, i) => (
                    <li
                      key={d.name}
                      className="flex items-center gap-2 text-xs"
                    >
                      <span
                        className="h-2 w-2 rounded-sm shrink-0"
                        style={{
                          background: CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                      <span className="flex-1 truncate text-foreground">
                        {d.name}
                      </span>
                      <span className="tabular text-foreground-muted">
                        {formatCurrency(d.value, displayCurrency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add / edit project — dialog keeps the page free for the projects. */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {form.id ? t.projects.editProject : t.projects.addProject}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submitProject} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="proj-name">{t.projects.name}</Label>
              <Input
                id="proj-name"
                autoFocus
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t.projects.namePlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-slug">{t.projects.slug}</Label>
              <Input
                id="proj-slug"
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder={
                  form.name ? slugify(form.name) : t.projects.slugPlaceholder
                }
              />
              <p className="text-[11px] text-foreground-subtle">
                {t.projects.slugHint}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-repo">{t.projects.repo}</Label>
              <Input
                id="proj-repo"
                value={form.repo_full_name}
                onChange={(e) =>
                  setForm({ ...form, repo_full_name: e.target.value })
                }
                placeholder={t.projects.repoPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-url">{t.projects.url}</Label>
              <Input
                id="proj-url"
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder={t.projects.urlPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proj-dev-url">{t.projects.devUrl}</Label>
              <Input
                id="proj-dev-url"
                value={form.dev_url}
                onChange={(e) => setForm({ ...form, dev_url: e.target.value })}
                placeholder={t.projects.devUrlPlaceholder}
              />
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                onClick={() => setFormOpen(false)}
              >
                {t.common.cancel}
              </Button>
              <Button type="submit" disabled={saving}>
                {form.id ? t.common.save : t.common.add}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Dense summary table. Detailed operations remain available from each
          row and the canonical /projects/[slug] workspace. */}
      {projects.length === 0 ? (
        <div className="mt-4">
          <Card>
            <CardContent className="py-8">
              <EmptyState
                icon={FolderKanban}
                title={t.projects.noProjects}
                description={t.projects.addFirstProject}
                action={
                  <Button size="sm" onClick={openNewProject}>
                    <Plus className="h-3.5 w-3.5" />
                    {t.projects.addProject}
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={ordered.map((p) => p.id)}
            strategy={verticalListSortingStrategy}
          >
            <Card className="mt-4 overflow-hidden p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1040px] text-left text-sm">
                  <thead className="border-b border-border bg-surface-secondary text-[11px] text-foreground-muted"><tr><th scope="col" className="w-10 px-2 py-2.5"><span className="sr-only">{t.projects.dragHandle}</span></th><th scope="col" className="px-3 py-2.5 font-medium">{t.projects.tableProject}</th><th scope="col" className="px-3 py-2.5 font-medium">{t.projects.tableClient}</th><th scope="col" className="px-3 py-2.5 font-medium">{t.projects.tableHealth}</th><th scope="col" className="px-3 py-2.5 font-medium">{t.projects.tableRepository}</th><th scope="col" className="px-3 py-2.5 text-right font-medium">{t.projects.tableMonthlyCost}</th><th scope="col" className="px-3 py-2.5 text-right font-medium">{t.projects.tableTasks}</th><th scope="col" className="px-3 py-2.5 font-medium">{t.projects.tableNextDate}</th><th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">{t.projects.tableActions}</span></th></tr></thead>
                  <tbody className="divide-y divide-border">
              {ordered.map((p) => {
                const projectTodos = todos.filter((item) => item.project_id === p.id || (!item.project_id && p.repo_full_name != null && item.repo_full_name === p.repo_full_name));
                const projectDates = importantDates.filter((item) => item.project_id === p.id && item.the_date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.the_date.localeCompare(b.the_date));
                const organization = organizations.find((item) => item.id === p.organization_id);
                return <SortableProjectRow
                  key={p.id}
                  project={p}
                  monthlyCost={projectMonthlyIn(costsByProject.get(p.id) ?? [], cronsByProject.get(p.id) ?? [], displayCurrency)}
                  displayCurrency={displayCurrency}
                  synced={!!p.repo_full_name && activeRepoNames.has(p.repo_full_name.toLowerCase())}
                  onEdit={() => startEditProject(p)}
                  onToggleActive={() => toggleProjectActive(p)}
                  onDelete={() => deleteProject(p)}
                  onManage={() => setManageProjectId(p.id)}
                  onOpen={() => onOpenProject(p)}
                  health={assessProjectHealth(p, projectTodos, costsByProject.get(p.id) ?? [], cronsByProject.get(p.id) ?? []).health}
                  openTaskCount={projectTodos.filter((item) => !item.done).length}
                  organizationName={organization?.name}
                  nextDate={projectDates[0]?.the_date}
                />
              })}
                  </tbody>
                </table>
              </div>
            </Card>
          </SortableContext>
        </DndContext>
      )}

      <Dialog open={manageProjectId !== null} onOpenChange={(open) => !open && setManageProjectId(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader><DialogTitle>{t.projects.manage}</DialogTitle></DialogHeader>
          {ordered.find((project) => project.id === manageProjectId) && (() => {
            const project = ordered.find((item) => item.id === manageProjectId)!;
            const projectTodos = todos.filter((item) => item.project_id === project.id || (!item.project_id && project.repo_full_name != null && item.repo_full_name === project.repo_full_name));
            const projectDates = importantDates.filter((item) => item.project_id === project.id && item.the_date >= new Date().toISOString().slice(0, 10)).sort((a, b) => a.the_date.localeCompare(b.the_date));
            return <ProjectCard project={project} costs={costsByProject.get(project.id) ?? []} crons={cronsByProject.get(project.id) ?? []} setCosts={setCosts} setCrons={setCrons} setProjects={setProjects} displayCurrency={displayCurrency} editing={form.id === project.id} synced={!!project.repo_full_name && activeRepoNames.has(project.repo_full_name.toLowerCase())} collapsed={false} collapsible={false} onToggleCollapsed={() => undefined} onOpen={() => onOpenProject(project)} onEdit={() => startEditProject(project)} onToggleActive={() => toggleProjectActive(project)} onDelete={() => deleteProject(project)} health={assessProjectHealth(project, projectTodos, costsByProject.get(project.id) ?? [], cronsByProject.get(project.id) ?? []).health} openTaskCount={projectTodos.filter((item) => !item.done).length} organizationName={organizations.find((item) => item.id === project.organization_id)?.name} nextDate={projectDates[0]?.the_date} />;
          })()}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Project card: totals, cost lines, notes, crons.
// ---------------------------------------------------------------------------

type ProjectCardProps = {
  project: Project;
  costs: ProjectCost[];
  crons: Cron[];
  setCosts: Updater<ProjectCost[]>;
  setCrons: Updater<Cron[]>;
  setProjects: Updater<Project[]>;
  displayCurrency: string;
  editing: boolean;
  /** True when this project mirrors a currently-active Repository. */
  synced: boolean;
  collapsed: boolean;
  collapsible?: boolean;
  onToggleCollapsed: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onOpen: () => void;
  health: ProjectHealth;
  openTaskCount: number;
  organizationName?: string;
  nextDate?: string;
};

function SortableProjectRow({
  project,
  monthlyCost,
  displayCurrency,
  synced,
  health,
  openTaskCount,
  organizationName,
  nextDate,
  onEdit,
  onToggleActive,
  onDelete,
  onManage,
  onOpen,
}: {
  project: Project;
  monthlyCost: number;
  displayCurrency: string;
  synced: boolean;
  health: ProjectHealth;
  openTaskCount: number;
  organizationName?: string;
  nextDate?: string;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onManage: () => void;
  onOpen: () => void;
}) {
  const t = useDict();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: project.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };
  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn("group align-middle hover:bg-surface-hover", !project.is_active && "opacity-60", isDragging && "relative z-10 bg-surface-elevated shadow-elevated")}
    >
      <td className="px-2 py-2.5"><button ref={setActivatorNodeRef} type="button" aria-label={t.projects.dragHandle} className="inline-flex h-8 w-8 touch-none select-none items-center justify-center rounded-md text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-ring active:cursor-grabbing md:cursor-grab" {...attributes} {...listeners}><GripVertical className="h-4 w-4" /></button></td>
      <td className="px-3 py-2.5"><Link href={`/projects/${encodeURIComponent(project.slug)}`} prefetch={false} onClick={(event) => { event.preventDefault(); onOpen(); }} className="font-medium text-foreground hover:underline focus-ring">{project.name}</Link><div className="mt-1 flex flex-wrap gap-1"><StatusBadge value={project.status ?? (project.is_active ? "active" : "archived")} />{synced && <EntityBadge><GithubIcon className="mr-1 h-3 w-3" />{t.projects.synced}</EntityBadge>}</div></td>
      <td className="px-3 py-2.5 text-xs text-foreground-muted">{organizationName ?? "—"}</td>
      <td className="px-3 py-2.5"><StatusBadge value={health} /></td>
      <td className="max-w-44 px-3 py-2.5 font-mono text-xs text-foreground-muted">{project.repo_full_name ? <a href={`https://github.com/${project.repo_full_name}`} target="_blank" rel="noreferrer" className="hover:underline">{project.repo_full_name}</a> : "—"}</td>
      <td className="px-3 py-2.5 text-right font-medium tabular">{formatCurrency(monthlyCost, displayCurrency)}</td>
      <td className="px-3 py-2.5 text-right tabular text-foreground-muted">{openTaskCount}</td>
      <td className="px-3 py-2.5 text-xs tabular text-foreground-muted">{nextDate ?? "—"}</td>
      <td className="px-3 py-2.5"><div className="flex justify-end gap-1">
        {project.dev_url && <Tooltip content={t.projects.development}><Button asChild size="icon-sm" variant="ghost"><a href={project.dev_url} target="_blank" rel="noreferrer" aria-label={t.projects.development}><ExternalLink /></a></Button></Tooltip>}
        <Tooltip content={t.projects.workspace}><Button asChild size="icon-sm" variant="ghost"><Link href={`/projects/${encodeURIComponent(project.slug)}`} prefetch={false} onClick={(event) => { event.preventDefault(); onOpen(); }} aria-label={t.projects.workspace}><FolderKanban /></Link></Button></Tooltip>
        <Tooltip content={t.projects.manage}><Button size="icon-sm" variant="ghost" onClick={onManage} aria-label={t.projects.manage}><Cpu /></Button></Tooltip>
        <Tooltip content={t.common.edit}><Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={t.common.edit}><Pencil /></Button></Tooltip>
        <Tooltip content={project.is_active ? t.projects.markInactive : t.projects.markActive}><Button size="icon-sm" variant="ghost" onClick={onToggleActive} aria-label={project.is_active ? t.projects.markInactive : t.projects.markActive}><Power /></Button></Tooltip>
        <Tooltip content={t.projects.deleteProject}><Button size="icon-sm" variant="ghost" onClick={onDelete} aria-label={t.projects.deleteProject}><Trash2 className="text-destructive" /></Button></Tooltip>
      </div></td>
    </tr>
  );
}

function ProjectCard({
  project,
  costs,
  crons,
  setCosts,
  setCrons,
  setProjects,
  displayCurrency,
  editing,
  synced,
  collapsed,
  collapsible = true,
  onToggleCollapsed,
  onEdit,
  onToggleActive,
  onDelete,
  onOpen,
  health,
  openTaskCount,
  organizationName,
  nextDate,
  isDragging,
  dragHandleProps,
}: ProjectCardProps & {
  isDragging?: boolean;
  dragHandleProps?: React.HTMLAttributes<HTMLButtonElement>;
}) {
  const t = useDict();
  const monthly = projectMonthlyIn(costs, crons, displayCurrency);
  const yearly = monthly * 12;

  return (
    <Card
      className={cn(
        editing && "ring-1 ring-ring",
        !project.is_active && "opacity-70",
        isDragging && "shadow-elevated ring-1 ring-border-strong",
      )}
    >
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex min-w-0 items-start gap-1.5">
          <button
            type="button"
            aria-label={t.projects.dragHandle}
            className="mt-0.5 shrink-0 cursor-grab touch-none rounded text-foreground-subtle transition-colors hover:text-foreground focus-ring active:cursor-grabbing"
            {...dragHandleProps}
          >
            <GripVertical className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2 text-base">
              <FolderKanban className="h-4 w-4 shrink-0 text-foreground-subtle" />
              <span className="truncate">{project.name}</span>
              <StatusBadge value={project.status ?? (project.is_active ? "active" : "archived")} />
              <StatusBadge value={health} />
              {!project.is_active && (
                <SectionLabel className="inline">{t.projects.inactive}</SectionLabel>
              )}
              {synced && (
                <Tooltip content={t.projects.syncedHint}>
                  <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground-muted">
                    <GithubIcon className="h-2.5 w-2.5" />
                    {t.projects.synced}
                  </span>
                </Tooltip>
              )}
            </CardTitle>
            {!collapsed && (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-foreground-subtle">
                {organizationName && <EntityBadge>{organizationName}</EntityBadge>}
                <span className="tabular">{t.professional.openTasks}: {openTaskCount}</span>
                {nextDate && <span className="tabular">{t.nav.sections.dates}: {nextDate}</span>}
                {project.repo_full_name && (
                  <a
                    href={`https://github.com/${project.repo_full_name}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground focus-ring rounded"
                  >
                    <GithubIcon className="h-3 w-3" />
                    {project.repo_full_name}
                  </a>
                )}
                {project.url && (
                  <a
                    href={project.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 hover:text-foreground focus-ring rounded"
                  >
                    <ExternalLink className="h-3 w-3" />
                    {t.projects.open}
                  </a>
                )}
                <Link
                  href={`/projects/${encodeURIComponent(project.slug)}`}
                  prefetch={false}
                  onClick={(event) => {
                    event.preventDefault();
                    onOpen();
                  }}
                  className="inline-flex items-center gap-1 hover:text-foreground focus-ring rounded"
                >
                  <FolderKanban className="h-3 w-3" />
                  {t.professional.projectWorkspace}
                </Link>
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="text-right">
            <p className="text-lg font-semibold tabular leading-none">
              {formatCurrency(monthly, displayCurrency)}
              <span className="text-xs font-normal text-foreground-subtle">
                {t.projects.perMo}
              </span>
            </p>
            <p className="text-[11px] text-foreground-subtle tabular mt-0.5">
              {t.projects.perYr(formatCurrency(yearly, displayCurrency))}
            </p>
          </div>
          <div className="flex gap-0.5">
            {collapsible && <Tooltip content={collapsed ? t.projects.expand : t.projects.collapse}>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onToggleCollapsed}
                aria-label={collapsed ? t.projects.expand : t.projects.collapse}
                aria-expanded={!collapsed}
              >
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 transition-transform",
                    collapsed && "-rotate-90",
                  )}
                />
              </Button>
            </Tooltip>}
            <Tooltip content={t.common.edit}>
              <Button size="icon-sm" variant="ghost" onClick={onEdit} aria-label={t.common.edit}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </Tooltip>
            <Tooltip
              content={project.is_active ? t.projects.markInactive : t.projects.markActive}
            >
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onToggleActive}
                aria-label={project.is_active ? t.projects.markInactive : t.projects.markActive}
              >
                <Power
                  className={cn(
                    "h-3.5 w-3.5",
                    project.is_active ? "text-success" : "text-foreground-subtle",
                  )}
                />
              </Button>
            </Tooltip>
            <Tooltip content={t.projects.deleteProject}>
              <Button
                size="icon-sm"
                variant="ghost"
                onClick={onDelete}
                aria-label={t.projects.deleteProject}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </Tooltip>
          </div>
        </div>
      </CardHeader>
      {!collapsed && (
        <CardContent className="space-y-5">
          <CostsSection
            project={project}
            costs={costs}
            setCosts={setCosts}
            displayCurrency={displayCurrency}
          />
          <NotesSection project={project} setProjects={setProjects} />
          <CronsSection
            project={project}
            crons={crons}
            setCrons={setCrons}
            displayCurrency={displayCurrency}
          />
        </CardContent>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Cost lines
// ---------------------------------------------------------------------------

function CostsSection({
  project,
  costs,
  setCosts,
  displayCurrency,
}: {
  project: Project;
  costs: ProjectCost[];
  setCosts: Updater<ProjectCost[]>;
  displayCurrency: string;
}) {
  const supabase = createClient();
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(displayCurrency);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const total = costsMonthlyIn(costs, displayCurrency);

  async function addCost(e: React.FormEvent) {
    e.preventDefault();
    if (!label.trim() || !amount) return;
    setBusy(true);
    try {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error(t.quickAdd.signInFirst);
      const { data, error } = await supabase
        .from("project_costs")
        .insert({
          user_id: userId,
          project_id: project.id,
          label: label.trim(),
          amount: Number(amount),
          currency,
          note: note.trim(),
          sort_order: costs.length,
        })
        .select()
        .single();
      if (error) throw error;
      setCosts((prev) => [...prev, data as ProjectCost]);
      setLabel("");
      setAmount("");
      setNote("");
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCost(id: string) {
    if (!await confirm({
      title: t.projects.deleteCost,
      description: t.projects.deleteCost,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error } = await supabase.from("project_costs").delete().eq("id", id);
    if (error) return toast.err(error.message);
    setCosts((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel>{t.projects.costs}</SectionLabel>
        <span className="text-[11px] text-foreground-subtle tabular">
          {formatCurrency(total, displayCurrency)}
          {t.projects.perMo}
        </span>
      </div>
      {costs.length === 0 ? (
        <p className="mt-2 text-xs text-foreground-subtle">{t.projects.noCosts}</p>
      ) : (
        <ul className="mt-2 divide-y divide-border/70">
          {costs.map((c) => (
            <li key={c.id} className="group flex items-center gap-3 py-1.5">
              <span className="min-w-0 flex-1 truncate text-sm">{c.label}</span>
              {c.note && (
                <span className="hidden truncate text-[11px] text-foreground-subtle sm:inline">
                  {c.note}
                </span>
              )}
              <span className="shrink-0 text-right text-sm tabular">
                {formatCurrency(c.amount, c.currency)}
                {t.projects.perMo}
                {c.currency !== displayCurrency && (
                  <span className="ml-1 text-[11px] text-foreground-subtle">
                    ≈ {formatCurrency(costMonthlyIn(c, displayCurrency), displayCurrency)}
                  </span>
                )}
              </span>
              <Button
                size="icon-sm"
                variant="ghost"
                className="shrink-0 opacity-0 group-hover:opacity-100"
                onClick={() => removeCost(c.id)}
                aria-label={t.projects.deleteCost}
              >
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={addCost} className="mt-2 flex flex-wrap items-end gap-2">
        <Input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t.projects.costLabelPlaceholder}
          className="h-8 w-32 text-sm"
          aria-label={t.projects.costLabel}
        />
        <Input
          type="number"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="h-8 w-24 text-sm"
          aria-label={t.projects.amount}
        />
        <SimpleSelect
          value={currency}
          onValueChange={setCurrency}
          aria-label={t.projects.currency}
          className="h-8 w-20 text-xs"
          options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
        />
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t.projects.costNotePlaceholder}
          className="h-8 min-w-0 flex-1 text-sm"
          aria-label={t.projects.costNotePlaceholder}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy}>
          <Plus className="h-3.5 w-3.5" />
          {t.projects.addCost}
        </Button>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick notes (mirrors the Notes section idea)
// ---------------------------------------------------------------------------

function NotesSection({
  project,
  setProjects,
}: {
  project: Project;
  setProjects: Updater<Project[]>;
}) {
  const supabase = createClient();
  const t = useDict();
  const toast = useToast();
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  // Last value we persisted, so a lossy markdown round-trip on mount doesn't
  // trigger a spurious write.
  const lastSavedRef = useRef(project.notes ?? "");
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime autosave — the editor debounces, this persists. No save button.
  async function saveMarkdown(md: string) {
    const next = md.trim();
    if (next === (lastSavedRef.current ?? "").trim()) return;
    setStatus("saving");
    const { error } = await supabase
      .from("projects")
      .update({ notes: next, updated_at: new Date().toISOString() })
      .eq("id", project.id);
    if (error) {
      setStatus("idle");
      toast.err(error.message);
      return;
    }
    lastSavedRef.current = next;
    setProjects((prev) =>
      prev.map((p) => (p.id === project.id ? { ...p, notes: next } : p)),
    );
    setStatus("saved");
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setStatus("idle"), 1500);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <SectionLabel>{t.projects.notes}</SectionLabel>
        <span className="text-[11px] text-foreground-subtle">
          {status === "saving"
            ? t.projects.saving
            : status === "saved"
              ? t.projects.notesSaved
              : ""}
        </span>
      </div>
      <div className="project-notes mt-2 min-h-[96px] rounded-md border border-border bg-surface py-1">
        <ProjectNotesEditor
          projectId={project.id}
          initialMarkdown={project.notes ?? ""}
          onSaveMarkdown={saveMarkdown}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Crons
// ---------------------------------------------------------------------------

type CronForm = {
  id?: string;
  name: string;
  schedule: string;
  endpoint: string;
  description: string;
  is_ai_call: boolean;
  cost_per_run: string;
  currency: string;
  runs_per_month: string;
};

function emptyCronForm(currency: string): CronForm {
  return {
    name: "",
    schedule: "0 6 * * *",
    endpoint: "",
    description: "",
    is_ai_call: false,
    cost_per_run: "",
    currency,
    runs_per_month: "30",
  };
}

function CronsSection({
  project,
  crons,
  setCrons,
  displayCurrency,
}: {
  project: Project;
  crons: Cron[];
  setCrons: Updater<Cron[]>;
  displayCurrency: string;
}) {
  const supabase = createClient();
  const t = useDict();
  const toast = useToast();
  const confirm = useConfirmation();
  const [form, setForm] = useState<CronForm>(emptyCronForm(displayCurrency));
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const aiSpend = cronsMonthlyIn(crons, displayCurrency);
  const registryUrl = `/api/crons/registry?project=${project.slug}`;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    const payload = {
      name: form.name.trim(),
      schedule: form.schedule.trim() || "0 6 * * *",
      endpoint: form.endpoint.trim(),
      description: form.description.trim(),
      is_ai_call: form.is_ai_call,
      cost_per_run: form.is_ai_call ? Number(form.cost_per_run || 0) : 0,
      currency: form.currency,
      runs_per_month: Number(form.runs_per_month || 0),
    };
    try {
      if (form.id) {
        const { data, error } = await supabase
          .from("crons")
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq("id", form.id)
          .select()
          .single();
        if (error) throw error;
        setCrons((prev) => prev.map((c) => (c.id === form.id ? (data as Cron) : c)));
      } else {
        const userId = await currentUserId(supabase);
        if (!userId) throw new Error(t.quickAdd.signInFirst);
        const { data, error } = await supabase
          .from("crons")
          .insert({ ...payload, user_id: userId, project_id: project.id })
          .select()
          .single();
        if (error) throw error;
        setCrons((prev) => [...prev, data as Cron]);
      }
      setForm(emptyCronForm(displayCurrency));
      setOpen(false);
    } catch (err) {
      toast.err((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled(c: Cron) {
    const next = !c.enabled;
    setCrons((prev) => prev.map((x) => (x.id === c.id ? { ...x, enabled: next } : x)));
    const { error } = await supabase
      .from("crons")
      .update({ enabled: next, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    if (error) {
      setCrons((prev) => prev.map((x) => (x.id === c.id ? { ...x, enabled: !next } : x)));
      toast.err(error.message);
    }
  }

  async function remove(c: Cron) {
    if (!await confirm({
      title: t.projects.deleteCron,
      description: t.projects.deleteCronConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) return;
    const { error } = await supabase.from("crons").delete().eq("id", c.id);
    if (error) return toast.err(error.message);
    setCrons((prev) => prev.filter((x) => x.id !== c.id));
  }

  function startEdit(c: Cron) {
    setForm({
      id: c.id,
      name: c.name,
      schedule: c.schedule,
      endpoint: c.endpoint,
      description: c.description,
      is_ai_call: c.is_ai_call,
      cost_per_run: String(c.cost_per_run),
      currency: c.currency,
      runs_per_month: String(c.runs_per_month),
    });
    setOpen(true);
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SectionLabel>{t.projects.crons}</SectionLabel>
          {aiSpend > 0 && (
            <span className="inline-flex items-center gap-1 rounded bg-accent px-1.5 py-0.5 text-[10px] text-foreground-muted tabular">
              <Cpu className="h-3 w-3" />
              {t.projects.aiSpendMonthly} {formatCurrency(aiSpend, displayCurrency)}
              {t.projects.perMo}
            </span>
          )}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setForm(emptyCronForm(displayCurrency));
            setOpen((v) => !v);
          }}
        >
          <Plus className="h-3.5 w-3.5" />
          {t.projects.addCron}
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-foreground-subtle">
        {t.projects.registryHint(registryUrl)}
      </p>

      {crons.length === 0 ? (
        <p className="mt-2 text-xs text-foreground-subtle">{t.projects.noCrons}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {crons.map((c) => {
            const est = cronMonthlyIn(c, displayCurrency);
            return (
              <li
                key={c.id}
                className={cn(
                  "group flex items-center gap-3 rounded-md border border-border/70 px-2.5 py-1.5",
                  !c.enabled && "opacity-55",
                )}
              >
                <Clock className="h-3.5 w-3.5 shrink-0 text-foreground-subtle" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {c.name}
                    {c.is_ai_call && (
                      <Cpu className="ml-1 inline h-3 w-3 text-foreground-subtle" />
                    )}
                  </p>
                  <p className="truncate text-[11px] text-foreground-subtle tabular">
                    <code>{c.schedule}</code>
                    {c.endpoint ? ` · ${c.endpoint}` : ""}
                    {c.is_ai_call
                      ? ` · ${formatCurrency(c.cost_per_run, c.currency)}×${c.runs_per_month} = ${formatCurrency(est, displayCurrency)}${t.projects.perMo}`
                      : ""}
                  </p>
                </div>
                <Tooltip content={c.enabled ? t.projects.disable : t.projects.enable}>
                  <span>
                    <Switch
                      checked={c.enabled}
                      onCheckedChange={() => toggleEnabled(c)}
                      aria-label={c.enabled ? t.projects.disable : t.projects.enable}
                    />
                  </span>
                </Tooltip>
                <div className="flex shrink-0 gap-0.5 opacity-0 group-hover:opacity-100">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => startEdit(c)}
                    aria-label={t.common.edit}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => remove(c)}
                    aria-label={t.projects.deleteCron}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {open && (
        <form
          onSubmit={submit}
          className="mt-3 space-y-3 rounded-md border border-border bg-surface-muted/40 p-3"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="space-y-1">
              <Label className="text-xs">{t.projects.cronName}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={t.projects.cronNamePlaceholder}
                className="h-8 text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{t.projects.schedule}</Label>
              <Input
                value={form.schedule}
                onChange={(e) => setForm({ ...form, schedule: e.target.value })}
                placeholder={t.projects.schedulePlaceholder}
                className="h-8 text-sm font-mono"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.projects.endpoint}</Label>
            <Input
              value={form.endpoint}
              onChange={(e) => setForm({ ...form, endpoint: e.target.value })}
              placeholder={t.projects.endpointPlaceholder}
              className="h-8 text-sm font-mono"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t.projects.cronDescription}</Label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder={t.projects.cronDescriptionPlaceholder}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Switch
              checked={form.is_ai_call}
              onCheckedChange={(v) => setForm({ ...form, is_ai_call: v })}
              aria-label={t.projects.aiCall}
              id={`ai-${project.id}`}
            />
            <Label htmlFor={`ai-${project.id}`} className="text-xs">
              {t.projects.aiCall}
              <span className="ml-1 text-foreground-subtle">
                — {t.projects.aiCallHint}
              </span>
            </Label>
          </div>
          {form.is_ai_call && (
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1">
                <Label className="text-xs">{t.projects.costPerRun}</Label>
                <Input
                  type="number"
                  step="0.0001"
                  value={form.cost_per_run}
                  onChange={(e) =>
                    setForm({ ...form, cost_per_run: e.target.value })
                  }
                  placeholder="0.05"
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t.projects.currency}</Label>
                <SimpleSelect
                  value={form.currency}
                  onValueChange={(v) => setForm({ ...form, currency: v })}
                  className="h-8 text-xs"
                  options={SUPPORTED_CURRENCIES.map((c) => ({ value: c, label: c }))}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">{t.projects.runsPerMonth}</Label>
                <Input
                  type="number"
                  value={form.runs_per_month}
                  onChange={(e) =>
                    setForm({ ...form, runs_per_month: e.target.value })
                  }
                  placeholder="30"
                  className="h-8 text-sm"
                />
              </div>
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => {
                setForm(emptyCronForm(displayCurrency));
                setOpen(false);
              }}
            >
              {t.common.cancel}
            </Button>
            <Button type="submit" size="sm" disabled={busy}>
              {form.id ? t.common.save : t.common.add}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
