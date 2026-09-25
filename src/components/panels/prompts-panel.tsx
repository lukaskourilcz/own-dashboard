"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Check,
  ChevronDown,
  Copy,
  Link2,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { EntityBadge } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { LinkPickerDialog } from "@/components/links/link-picker-dialog";
import { PricingDot } from "@/components/panels/link-library-card";
import { PromptCopyDialog } from "@/components/prompts/prompt-copy-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import { CURATED_PROMPTS } from "@/lib/curated-prompts";
import {
  PROMPT_KINDS,
  categoryMatchesKind,
  categoryMatchesWords,
  groupPromptsByKind,
  promptKind,
  type PromptKind,
} from "@/lib/prompt-kinds";
import {
  planPromptLinkSync,
  promptLinkDrafts,
  suggestedLinkIds,
  type PromptLinkDraft,
} from "@/lib/prompt-links";
import type {
  AiCategory,
  AiLink,
  Project,
  ProjectLink,
  Prompt,
  PromptLink,
  Updater,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  prompts: Prompt[];
  setPrompts: Updater<Prompt[]>;
  promptLinks: PromptLink[];
  setPromptLinks: Updater<PromptLink[]>;
  projects: Project[];
  aiLinks: AiLink[];
  aiCategories: AiCategory[];
  projectLinks: ProjectLink[];
};

type PromptForm = {
  name: string;
  description: string;
  body: string;
  kind: PromptKind;
  project_id: string;
  is_public: boolean;
  links: PromptLinkDraft[];
};

const emptyForm: PromptForm = {
  name: "",
  description: "",
  body: "",
  kind: "other",
  project_id: "",
  is_public: false,
  links: [],
};

type PromptVars = Omit<PromptForm, "links"> & { id?: string; links: PromptLinkDraft[] };

export function PromptsPanel({
  prompts,
  setPrompts,
  promptLinks,
  setPromptLinks,
  projects,
  aiLinks,
  aiCategories,
  projectLinks,
}: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const confirm = useConfirmation();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<PromptKind | "all">("all");
  const [collapsed, setCollapsed] = useState<Set<PromptKind>>(() => new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [form, setForm] = useState<PromptForm>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerKey, setPickerKey] = useState(0);
  const [copyPrompt, setCopyPrompt] = useState<Prompt | null>(null);

  const linkById = useMemo(() => new Map(aiLinks.map((link) => [link.id, link])), [aiLinks]);
  const projectName = useMemo(() => new Map(projects.map((project) => [project.id, project.name])), [projects]);
  const linkCount = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of promptLinks) counts.set(row.prompt_id, (counts.get(row.prompt_id) ?? 0) + 1);
    return counts;
  }, [promptLinks]);

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) =>
      `${p.name}\n${p.description}\n${p.body}\n${t.prompts.kindLabel[promptKind(p)]}`.toLowerCase().includes(q),
    );
  }, [prompts, query, t.prompts.kindLabel]);
  const filtered = useMemo(
    () => (kindFilter === "all" ? searched : searched.filter((p) => promptKind(p) === kindFilter)),
    [searched, kindFilter],
  );
  const groups = useMemo(() => groupPromptsByKind(filtered), [filtered]);
  const availableKinds = useMemo(() => groupPromptsByKind(prompts).map((group) => group.kind), [prompts]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Prompt) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      body: p.body,
      kind: promptKind(p),
      project_id: p.project_id ?? "",
      is_public: p.is_public ?? false,
      links: promptLinkDrafts(p.id, promptLinks, aiLinks),
    });
    setFormError(null);
    setDialogOpen(true);
  }

  /** Bring the prompt's stored links in line with the editor's list. */
  async function syncLinks(promptId: string, userId: string, links: PromptLinkDraft[]) {
    const plan = planPromptLinkSync(promptId, promptLinks, links);
    if (plan.removeIds.length > 0) {
      const { error } = await supabase.from("prompt_links").delete().in("id", plan.removeIds);
      if (error) throw error;
    }
    let saved: PromptLink[] = [];
    if (plan.upserts.length > 0) {
      const now = new Date().toISOString();
      const { data, error } = await supabase
        .from("prompt_links")
        .upsert(
          plan.upserts.map((row) => ({ ...row, user_id: userId, prompt_id: promptId, updated_at: now })),
          { onConflict: "prompt_id,ai_link_id" },
        )
        .select();
      if (error) throw error;
      saved = (data ?? []) as PromptLink[];
    }
    const removed = new Set(plan.removeIds);
    setPromptLinks((previous) => [
      ...previous.filter(
        (row) =>
          !removed.has(row.id) &&
          !saved.some((next) => next.prompt_id === row.prompt_id && next.ai_link_id === row.ai_link_id),
      ),
      ...saved,
    ]);
    void qc.invalidateQueries({ queryKey: qk.promptLinks });
  }

  // Create or update the prompt, then its links. A failed link write keeps
  // the saved prompt and says so, rather than rolling the prompt back.
  const saveMutation = useMutation({
    mutationFn: async (vars: PromptVars) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const row = {
        name: vars.name,
        description: vars.description,
        body: vars.body,
        kind: vars.kind,
        project_id: vars.project_id || null,
        is_public: vars.is_public,
      };
      const { data, error } = vars.id
        ? await supabase
            .from("prompts")
            .update({ ...row, updated_at: new Date().toISOString() })
            .eq("id", vars.id)
            .select()
            .single()
        : await supabase.from("prompts").insert({ ...row, user_id: userId }).select().single();
      if (error || !data) throw error ?? new Error("no-data");
      const saved = data as Prompt;
      let linksOk = true;
      try {
        await syncLinks(saved.id, userId, vars.links);
      } catch {
        linksOk = false;
      }
      return { saved, created: !vars.id, linksOk };
    },
    onSuccess: ({ saved, created, linksOk }) => {
      setPrompts((prev) => (created ? [saved, ...prev] : prev.map((x) => (x.id === saved.id ? saved : x))));
      if (linksOk) toast.ok(created ? t.prompts.createdToast : t.prompts.savedToast);
      else toast.err(t.prompts.linksSaveFailed);
      void qc.invalidateQueries({ queryKey: qk.prompts });
      setDialogOpen(false);
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.prompts.signInFirst
          : t.prompts.couldNotSave,
      ),
  });

  // DELETE — optimistic, rolls back on error. prompt_links cascade.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prompts").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.prompts });
      const prev = qc.getQueryData<Prompt[]>(qk.prompts);
      const prevLinks = qc.getQueryData<PromptLink[]>(qk.promptLinks);
      setPrompts((old) => old.filter((p) => p.id !== id));
      setPromptLinks((old) => old.filter((row) => row.prompt_id !== id));
      return { prev, prevLinks };
    },
    onSuccess: () => toast.ok(t.prompts.deletedToast),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setPrompts(ctx.prev);
      if (ctx?.prevLinks) setPromptLinks(ctx.prevLinks);
      toast.err(t.prompts.couldNotDelete);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.prompts });
      void qc.invalidateQueries({ queryKey: qk.promptLinks });
    },
  });

  // Seed the curated prompts, skipping any already in the library (by name),
  // so a repeat click never duplicates. Owned by the user, flagged public.
  const addCuratedMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const have = new Set(prompts.map((p) => p.name.trim().toLowerCase()));
      const toAdd = CURATED_PROMPTS.filter(
        (c) => !have.has(c.name.trim().toLowerCase()),
      );
      if (toAdd.length === 0) return [] as Prompt[];
      const { data, error } = await supabase
        .from("prompts")
        .insert(
          toAdd.map((c) => ({
            user_id: userId,
            name: c.name,
            description: c.description,
            body: c.body,
            kind: c.kind,
            is_public: true,
          })),
        )
        .select();
      if (error) throw error;
      return (data ?? []) as Prompt[];
    },
    onSuccess: (rows) => {
      if (rows.length === 0) {
        toast.ok(t.prompts.curatedNoneNew);
        return;
      }
      setPrompts((prev) => [...rows, ...prev]);
      toast.ok(t.prompts.curatedAdded(rows.length));
      void qc.invalidateQueries({ queryKey: qk.prompts });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.prompts.signInFirst
          : t.prompts.couldNotSave,
      ),
  });

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const body = form.body.trim();
    if (!name) {
      setFormError(t.prompts.nameRequired);
      return;
    }
    if (!body) {
      setFormError(t.prompts.bodyRequired);
      return;
    }
    saveMutation.mutate({
      ...form,
      id: editing?.id,
      name,
      body,
      description: form.description.trim(),
    });
  }

  async function removePrompt(p: Prompt) {
    if (await confirm({
      title: t.common.delete,
      description: t.prompts.deleteConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteMutation.mutate(p.id);
  }

  // Suggested links pre-selected in the picker: a curated prompt's own
  // categories, otherwise the library categories that fit the kind.
  const pickerSuggestions = useMemo(() => {
    if (form.links.length > 0) return [];
    const curated = CURATED_PROMPTS.find((item) => item.name.toLowerCase() === form.name.trim().toLowerCase());
    return suggestedLinkIds(
      aiLinks,
      aiCategories,
      (categoryName) =>
        curated
          ? categoryMatchesWords(categoryName, curated.suggestedCategories)
          : categoryMatchesKind(categoryName, form.kind),
      new Set(form.links.map((link) => link.ai_link_id)),
    );
  }, [aiLinks, aiCategories, form.links, form.name, form.kind]);

  const addCuratedButton = (
    <Button
      size="sm"
      variant="outline"
      onClick={() => addCuratedMutation.mutate()}
      disabled={addCuratedMutation.isPending}
    >
      <Sparkles className="h-3.5 w-3.5" />
      {addCuratedMutation.isPending ? t.prompts.addingCurated : t.prompts.addCurated}
    </Button>
  );
  const searching = query.trim().length > 0 || kindFilter !== "all";

  return (
    <div>
      <PageHeader
        title={t.prompts.title}
        description={t.prompts.description}
        action={
          <div className="flex flex-wrap gap-2">
            {prompts.length > 0 && addCuratedButton}
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-3.5 w-3.5" />
              {t.prompts.newPrompt}
            </Button>
          </div>
        }
      />

      {prompts.length > 0 && (
        <div className="mb-4 space-y-3">
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
            <Input
              aria-label={t.prompts.searchPlaceholder}
              placeholder={t.prompts.searchPlaceholder}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-9 pl-8 text-sm"
            />
          </div>
          <div role="group" aria-label={t.prompts.kindFilter} className="flex flex-wrap gap-1.5">
            {(["all", ...availableKinds] as const).map((kind) => (
              <button
                key={kind}
                type="button"
                aria-pressed={kindFilter === kind}
                onClick={() => setKindFilter(kind)}
                className={cn(
                  "inline-flex min-h-9 items-center rounded-md border px-2.5 text-xs font-medium transition-colors focus-ring sm:min-h-7",
                  kindFilter === kind
                    ? "border-primary bg-surface-selected text-foreground"
                    : "border-border text-foreground-muted hover:bg-surface-hover hover:text-foreground",
                )}
              >
                {kind === "all" ? t.prompts.allKinds : t.prompts.kindLabel[kind]}
              </button>
            ))}
          </div>
        </div>
      )}

      {prompts.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={MessageSquareText}
            title={t.prompts.noPromptsYet}
            description={t.prompts.noPromptsDescription}
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button size="sm" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" />
                  {t.prompts.newPrompt}
                </Button>
                {addCuratedButton}
              </div>
            }
            className="py-16"
          />
        </Card>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t.prompts.noMatches}
          description={t.prompts.noMatchesDescription}
          className="py-16"
        />
      ) : (
        <div className="space-y-6">
          {groups.map((group) => {
            const open = searching || !collapsed.has(group.kind);
            const regionId = `prompt-kind-${group.kind}`;
            return (
              <section key={group.kind} aria-labelledby={`${regionId}-heading`}>
                <h2 id={`${regionId}-heading`} className="mb-3 border-b border-border pb-2">
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={regionId}
                    onClick={() =>
                      setCollapsed((previous) => {
                        const next = new Set(previous);
                        if (next.has(group.kind)) next.delete(group.kind);
                        else next.add(group.kind);
                        return next;
                      })
                    }
                    className="inline-flex min-h-9 items-center gap-2 rounded text-sm font-semibold text-foreground focus-ring sm:min-h-7"
                  >
                    <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 text-foreground-muted transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
                    {t.prompts.kindLabel[group.kind]}
                    <span className="text-[11px] font-medium tabular text-foreground-muted">
                      {t.prompts.groupCount(group.prompts.length)}
                    </span>
                  </button>
                </h2>
                <div id={regionId} hidden={!open} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {group.prompts.map((p) => (
                    <PromptCard
                      key={p.id}
                      prompt={p}
                      projectName={p.project_id ? projectName.get(p.project_id) : undefined}
                      linkCount={linkCount.get(p.id) ?? 0}
                      onCopy={() => setCopyPrompt(p)}
                      onEdit={() => openEdit(p)}
                      onDelete={() => removePrompt(p)}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <PromptCopyDialog
        prompt={copyPrompt}
        open={copyPrompt !== null}
        onOpenChange={(open) => !open && setCopyPrompt(null)}
        projects={projects}
        promptLinks={promptLinks}
        projectLinks={projectLinks}
        aiLinks={aiLinks}
        aiCategories={aiCategories}
      />

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.prompts.editTitle : t.prompts.newTitle}
            </DialogTitle>
            <DialogDescription className="sr-only">{t.prompts.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="mt-3 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-name">{t.prompts.name}</Label>
              <Input
                id="prompt-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={t.prompts.namePlaceholder}
                autoFocus
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-description">{t.prompts.descriptionLabel}</Label>
              <Input
                id="prompt-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder={t.prompts.descriptionPlaceholder}
                maxLength={160}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-kind">{t.prompts.kind}</Label>
              <SimpleSelect
                id="prompt-kind"
                value={form.kind}
                onValueChange={(value) => setForm((f) => ({ ...f, kind: value as PromptKind }))}
                options={PROMPT_KINDS.map((kind) => ({ value: kind, label: t.prompts.kindLabel[kind] }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-body">{t.prompts.promptText}</Label>
              <Textarea
                id="prompt-body"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder={t.prompts.promptPlaceholder}
                rows={8}
                aria-describedby="prompt-body-hint"
                className="font-mono text-xs"
              />
              <p id="prompt-body-hint" className="text-[11px] text-foreground-subtle [overflow-wrap:anywhere]">
                {t.prompts.placeholdersHint}
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p id="prompt-links-label" className="text-sm font-medium">{t.prompts.links}</p>
                  <p className="text-[11px] text-foreground-subtle">{t.prompts.linksHint}</p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setPickerKey((key) => key + 1);
                    setPickerOpen(true);
                  }}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t.prompts.addLinks}
                </Button>
              </div>
              {form.links.length === 0 ? (
                <p className="text-xs text-foreground-muted">{t.prompts.noLinks}</p>
              ) : (
                <ul aria-labelledby="prompt-links-label" className="divide-y divide-border rounded-md border border-border">
                  {form.links.map((draft, index) => {
                    const link = linkById.get(draft.ai_link_id);
                    if (!link) return null;
                    return (
                      <li key={draft.ai_link_id} className="flex items-center gap-2 px-2.5 py-2">
                        <PricingDot pricing={link.pricing} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-xs font-medium" title={link.url}>{link.title}</p>
                          <Input
                            aria-label={`${t.prompts.linkNote}: ${link.title}`}
                            value={draft.note}
                            maxLength={300}
                            placeholder={t.prompts.linkNotePlaceholder}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                links: f.links.map((item, itemIndex) => (itemIndex === index ? { ...item, note: e.target.value } : item)),
                              }))
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                        <Tooltip content={t.prompts.removeLink}>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="h-11 w-11 sm:h-7 sm:w-7"
                            aria-label={`${t.prompts.removeLink}: ${link.title}`}
                            onClick={() => setForm((f) => ({ ...f, links: f.links.filter((item) => item.ai_link_id !== draft.ai_link_id) }))}
                          >
                            <X />
                          </Button>
                        </Tooltip>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="prompt-project">{t.prompts.defaultProject}</Label>
              <SimpleSelect
                id="prompt-project"
                value={form.project_id}
                onValueChange={(project_id) => setForm((current) => ({ ...current, project_id }))}
                options={[
                  { value: "", label: t.prompts.noProject },
                  ...projects.map((project) => ({ value: project.id, label: project.name })),
                ]}
              />
              <p className="text-[11px] text-foreground-subtle">{t.prompts.defaultProjectHint}</p>
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-inset px-3 py-2.5">
              <div>
                <Label htmlFor="prompt-public">{t.prompts.makePublic}</Label>
                <p className="mt-0.5 text-[11px] text-foreground-subtle">
                  {t.prompts.makePublicHint}
                </p>
              </div>
              <Switch
                id="prompt-public"
                checked={form.is_public}
                onCheckedChange={(is_public) => setForm((f) => ({ ...f, is_public }))}
              />
            </div>
            {formError && <p className="text-xs text-destructive">{formError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <DialogClose asChild>
                <Button type="button" variant="ghost" size="sm">
                  {t.prompts.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" size="sm" disabled={saveMutation.isPending}>
                <Check className="h-3.5 w-3.5" />
                {saveMutation.isPending
                  ? t.prompts.saving
                  : editing
                    ? t.prompts.save
                    : t.prompts.create}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <LinkPickerDialog
        key={pickerKey}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        links={aiLinks}
        categories={aiCategories}
        excludeIds={new Set(form.links.map((link) => link.ai_link_id))}
        title={t.prompts.addLinks}
        initialSelectedIds={pickerSuggestions}
        onConfirm={(ids) =>
          setForm((f) => ({
            ...f,
            links: [...f.links, ...ids.filter((id) => !f.links.some((link) => link.ai_link_id === id)).map((id) => ({ ai_link_id: id, note: "" }))],
          }))
        }
      />
    </div>
  );
}

function PromptCard({
  prompt,
  projectName,
  linkCount,
  onCopy,
  onEdit,
  onDelete,
}: {
  prompt: Prompt;
  projectName?: string;
  linkCount: number;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  return (
    <motion.article
      layout
      data-prompt-card={prompt.id}
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-soft transition-colors hover:border-border-strong"
    >
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2">
        <h3
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
          title={prompt.name}
        >
          {prompt.name}
        </h3>
        {prompt.is_public && <EntityBadge className="min-h-5 py-0">{t.prompts.publicBadge}</EntityBadge>}
        <Tooltip content={t.prompts.copyWithContext}>
          <button
            type="button"
            onClick={onCopy}
            aria-label={`${t.prompts.copyWithContext}: ${prompt.name}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring sm:h-6 sm:w-6"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <button
        type="button"
        onClick={onCopy}
        aria-label={`${t.prompts.copyWithContext}: ${prompt.name}`}
        className="min-h-[64px] flex-1 cursor-copy px-3 pb-2 pt-2 text-left focus-ring"
      >
        {prompt.description?.trim() ? (
          <p className="line-clamp-3 text-[11px] leading-[15px] text-foreground-muted">
            {prompt.description}
          </p>
        ) : prompt.body?.trim() ? (
          <p className="line-clamp-3 text-[11px] leading-[15px] text-foreground-subtle">
            {prompt.body.replace(/\s+/g, " ").trim()}
          </p>
        ) : (
          <p className="text-[11px] italic leading-[15px] text-foreground-subtle">
            {t.prompts.noDescription}
          </p>
        )}
      </button>

      <div className="flex items-center gap-2 px-3 pb-2 text-[11px] text-foreground-muted">
        <span className="inline-flex min-w-0 items-center gap-1 truncate">
          <Link2 aria-hidden="true" className="h-3 w-3 shrink-0" />
          {t.prompts.linkCount(linkCount)}
        </span>
        {projectName && <span className="min-w-0 truncate">· {projectName}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <Tooltip content={t.prompts.edit}>
            <button
              type="button"
              onClick={onEdit}
              aria-label={`${t.prompts.edit}: ${prompt.name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring sm:h-6 sm:w-6"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip content={t.prompts.delete}>
            <button
              type="button"
              onClick={onDelete}
              aria-label={`${t.prompts.deletePrompt}: ${prompt.name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-destructive focus-ring sm:h-6 sm:w-6"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </motion.article>
  );
}
