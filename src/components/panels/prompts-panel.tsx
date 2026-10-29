"use client";

import { useMemo, useRef, useState } from "react";
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
  ListPlus,
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
  promptLinkDraftsForEdit,
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

type PromptVars = PromptForm & { id?: string; expectedUpdatedAt: string | null; expectedLinkIds: string[] | null };

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
  const requestId = useRef<string | null>(null);
  const [sourceLinkIds, setSourceLinkIds] = useState<string[]>([]);

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
    if (busy) return;
    requestId.current = null;
    setSourceLinkIds([]);
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Prompt) {
    if (busy) return;
    requestId.current = p.id;
    setSourceLinkIds(promptLinks.filter(row => row.prompt_id === p.id).map(row => row.id));
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      body: p.body,
      kind: promptKind(p),
      project_id: p.project_id ?? "",
      is_public: p.is_public ?? false,
      links: promptLinkDraftsForEdit(p.id, promptLinks),
    });
    setFormError(null);
    setDialogOpen(true);
  }

  // Header and links commit together. The request id survives a failed or
  // ambiguous response; source identity stays fixed while the editor is open.
  const saveMutation = useMutation({
    mutationFn: async (vars: PromptVars) => {
      requestId.current ??= crypto.randomUUID();
      const id = vars.id ?? requestId.current;
      const { data, error } = await supabase.rpc("save_prompt_document", {
        p_id: id, p_creating: !vars.id,
        p_header: { name: vars.name, description: vars.description, body: vars.body,
          kind: vars.kind, project_id: vars.project_id || null, is_public: vars.is_public },
        p_links: vars.links,
        p_expected_updated_at: vars.expectedUpdatedAt,
        p_expected_link_ids: vars.expectedLinkIds,
      });
      if (error) throw new Error(error.code === "40001" || error.code === "P0002" ? t.prompts.saveConflict : t.prompts.couldNotSave);
      const result = data as { prompt: Prompt; links: PromptLink[] } | null;
      if (result?.prompt?.id !== id || typeof result.prompt.name !== "string" || typeof result.prompt.body !== "string"
        || !Number.isFinite(Date.parse(result.prompt.updated_at)) || !Array.isArray(result.links) || result.links.length !== vars.links.length
        || new Set(result.links.map(row => row.ai_link_id)).size !== vars.links.length
        || result.links.some(row => typeof row.id !== "string" || row.prompt_id !== id || !vars.links.some(link => link.ai_link_id === row.ai_link_id))) {
        throw new Error(t.prompts.couldNotSave);
      }
      return { saved: result.prompt, links: result.links, created: !vars.id };
    },
    onSuccess: ({ saved, links, created }) => {
      setPrompts(previous => previous.some(prompt => prompt.id === saved.id)
        ? previous.map(prompt => prompt.id === saved.id ? saved : prompt) : [saved, ...previous]);
      setPromptLinks(previous => [...previous.filter(row => row.prompt_id !== saved.id), ...links]);
      void qc.invalidateQueries({ queryKey: qk.prompts });
      void qc.invalidateQueries({ queryKey: qk.promptLinks });
      toast.ok(created ? t.prompts.createdToast : t.prompts.savedToast);
      setDialogOpen(false);
    },
    onError: (error) => {
      setFormError(error.message);
      void qc.invalidateQueries({ queryKey: qk.prompts });
      void qc.invalidateQueries({ queryKey: qk.promptLinks });
    },
  });

  // DELETE — optimistic, rolls back on error. prompt_links cascade.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prompts").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await Promise.all([qc.cancelQueries({ queryKey: qk.prompts }), qc.cancelQueries({ queryKey: qk.promptLinks })]);
      const prev = (qc.getQueryData<Prompt[]>(qk.prompts) ?? prompts).find(prompt => prompt.id === id);
      const prevLinks = (qc.getQueryData<PromptLink[]>(qk.promptLinks) ?? promptLinks).filter(row => row.prompt_id === id);
      setPrompts((old) => old.filter((p) => p.id !== id));
      setPromptLinks((old) => old.filter((row) => row.prompt_id !== id));
      return { prev, prevLinks };
    },
    onSuccess: () => toast.ok(t.prompts.deletedToast),
    onError: (_error, id, ctx) => {
      const previous = ctx?.prev;
      if (previous) setPrompts(current => current.some(prompt => prompt.id === id) ? current : [previous, ...current]);
      if (ctx?.prevLinks) setPromptLinks(current => [...current.filter(row => row.prompt_id !== id), ...ctx.prevLinks]);
      toast.err(t.prompts.couldNotDelete);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.prompts });
      void qc.invalidateQueries({ queryKey: qk.promptLinks });
    },
  });

  // The server compares every owned name and serializes simultaneous imports.
  const addCuratedMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("add_curated_prompts", {
        p_templates: CURATED_PROMPTS.map(({ name, description, body, kind }) => ({ name, description, body, kind })),
      });
      if (error || !Array.isArray(data) || data.some(row => typeof row?.id !== "string" || typeof row.name !== "string")) {
        throw new Error(t.prompts.couldNotSave);
      }
      return data as Prompt[];
    },
    onSuccess: (rows) => {
      // A repeated import may confirm an earlier request whose HTTP response
      // was lost; refresh even when the server has nothing left to insert.
      void qc.invalidateQueries({ queryKey: qk.prompts });
      if (rows.length === 0) { toast.ok(t.prompts.curatedNoneNew); return; }
      const added = new Set(rows.map(row => row.id));
      setPrompts(previous => [...rows, ...previous.filter(row => !added.has(row.id))]);
      toast.ok(t.prompts.curatedAdded(rows.length));
    },
    onError: () => { toast.err(t.prompts.couldNotSave); void qc.invalidateQueries({ queryKey: qk.prompts }); },
  });

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    if (saveMutation.isPending) return;
    setFormError(null);
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
    if (form.links.length > 1000) { setFormError(t.prompts.tooManyLinks); return; }
    saveMutation.mutate({
      ...form,
      id: editing?.id,
      expectedUpdatedAt: editing?.updated_at ?? null,
      expectedLinkIds: editing ? sourceLinkIds : null,
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

  const busy = saveMutation.isPending || deleteMutation.isPending || addCuratedMutation.isPending;
  const addCuratedButton = (
    <Button
      size="sm"
      variant="outline"
      onClick={() => addCuratedMutation.mutate()}
      disabled={busy}
    >
      <ListPlus className="h-3.5 w-3.5" />
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
            <Button size="sm" onClick={openCreate} disabled={busy}>
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
              className="h-11 pl-8 text-sm md:h-8"
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
                <Button size="sm" onClick={openCreate} disabled={busy}>
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
        <div className="columns-1 gap-4 md:columns-2 xl:columns-3">
          {groups.map((group) => {
            const open = searching || !collapsed.has(group.kind);
            const regionId = `prompt-kind-${group.kind}`;
            return (
              <section key={group.kind} className="mb-5 break-inside-avoid" aria-labelledby={`${regionId}-heading`}>
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
                    className="inline-flex min-h-11 items-center gap-2 rounded text-sm font-semibold text-foreground focus-ring md:min-h-8"
                  >
                    <ChevronDown aria-hidden="true" className={cn("h-3.5 w-3.5 text-foreground-muted transition-transform motion-reduce:transition-none", !open && "-rotate-90")} />
                    {t.prompts.kindLabel[group.kind]}
                    <span className="text-[11px] font-medium tabular text-foreground-muted">
                      {t.prompts.groupCount(group.prompts.length)}
                    </span>
                  </button>
                </h2>
                <div id={regionId} hidden={!open} className="space-y-3">
                  {group.prompts.map((p) => (
                    <PromptCard
                      key={p.id}
                      prompt={p}
                      projectName={p.project_id ? projectName.get(p.project_id) : undefined}
                      linkCount={linkCount.get(p.id) ?? 0}
                      busy={busy}
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

      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!saveMutation.isPending) setDialogOpen(open); }}>
        <DialogContent showClose={!saveMutation.isPending} className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.prompts.editTitle : t.prompts.newTitle}
            </DialogTitle>
            <DialogDescription className="sr-only">{t.prompts.description}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submitForm} className="mt-3">
            <fieldset disabled={saveMutation.isPending} className="min-w-0 space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="prompt-name">{t.prompts.name}</Label>
              <Input
                id="prompt-name"
                required
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
                required
                maxLength={1_000_000}
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
                    const title = link?.title ?? t.prompts.unavailableLink(index + 1);
                    return (
                      <li key={draft.ai_link_id} className="flex items-center gap-2 px-2.5 py-2">
                        <PricingDot pricing={link?.pricing ?? null} />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p className="truncate text-xs font-medium" title={link?.url}>{title}</p>
                          <Input
                            aria-label={`${t.prompts.linkNote} ${index + 1}: ${title}`}
                            value={draft.note}
                            maxLength={300}
                            placeholder={t.prompts.linkNotePlaceholder}
                            onChange={(e) =>
                              setForm((f) => ({
                                ...f,
                                links: f.links.map((item, itemIndex) => (itemIndex === index ? { ...item, note: e.target.value } : item)),
                              }))
                            }
                            className="h-11 text-xs md:h-8"
                          />
                        </div>
                        <Tooltip content={t.prompts.removeLink}>
                          <Button
                            type="button"
                            size="icon-sm"
                            variant="ghost"
                            className="h-11 w-11 sm:h-7 sm:w-7"
                            aria-label={`${t.prompts.removeLink}: ${title}`}
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
            {formError && <p role="alert" className="text-xs text-destructive">{formError}</p>}
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
            </fieldset>
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
  busy,
}: {
  prompt: Prompt;
  busy: boolean;
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
      <div className="flex min-h-12 items-center gap-2 border-b border-border bg-surface-muted px-3 py-2">
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
            disabled={busy}
            aria-label={`${t.prompts.copyWithContext}: ${prompt.name}`}
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring md:h-8 md:w-8"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        </Tooltip>
      </div>

      <div className="min-h-16 flex-1 px-3 pb-2 pt-2">
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
            </div>

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
              disabled={busy}
              aria-label={`${t.prompts.edit}: ${prompt.name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-foreground focus-ring md:h-8 md:w-8"
            >
              <Pencil className="h-3 w-3" />
            </button>
          </Tooltip>
          <Tooltip content={t.prompts.delete}>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              aria-label={`${t.prompts.deletePrompt}: ${prompt.name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-md text-foreground-muted transition-colors hover:bg-surface-hover hover:text-destructive focus-ring md:h-8 md:w-8"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </Tooltip>
        </div>
      </div>
    </motion.article>
  );
}
