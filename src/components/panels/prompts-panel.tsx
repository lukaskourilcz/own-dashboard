"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/ui/dialog";
import {
  Check,
  Copy,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import { CURATED_PROMPTS } from "@/lib/curated-prompts";
import type { Project, Prompt, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  prompts: Prompt[];
  setPrompts: Updater<Prompt[]>;
  projects: Project[];
};

export function PromptsPanel({ prompts, setPrompts, projects }: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const confirm = useConfirmation();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [form, setForm] = useState<{
    name: string;
    description: string;
    body: string;
    project_id: string;
    is_public: boolean;
  }>({
    name: "",
    description: "",
    body: "",
    project_id: "",
    is_public: false,
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) =>
      `${p.name}\n${p.description}\n${p.body}`.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", description: "", body: "", project_id: "", is_public: false });
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Prompt) {
    setEditing(p);
    setForm({
      name: p.name,
      description: p.description ?? "",
      body: p.body,
      project_id: p.project_id ?? "",
      is_public: p.is_public ?? false,
    });
    setFormError(null);
    setDialogOpen(true);
  }

  // CREATE — non-optimistic: the insert returns the row, which we prepend and
  // then reconcile with the server via invalidate.
  const createMutation = useMutation({
    mutationFn: async (vars: { name: string; description: string; body: string; project_id: string; is_public: boolean }) => {
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("prompts")
        .insert({ user_id: userId, name: vars.name, description: vars.description, body: vars.body, project_id: vars.project_id || null, is_public: vars.is_public })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Prompt;
    },
    onSuccess: (p) => {
      setPrompts((prev) => [p, ...prev]);
      toast.ok(t.prompts.createdToast);
      void qc.invalidateQueries({ queryKey: qk.prompts });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.prompts.signInFirst
          : t.prompts.couldNotSave,
      ),
  });

  // UPDATE — the update returns the row; replace it in the cache on success.
  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; name: string; description: string; body: string; project_id: string; is_public: boolean }) => {
      const { data, error } = await supabase
        .from("prompts")
        .update({
          name: vars.name,
          description: vars.description,
          body: vars.body,
          project_id: vars.project_id || null,
          is_public: vars.is_public,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Prompt;
    },
    onSuccess: (p) => {
      setPrompts((prev) => prev.map((x) => (x.id === p.id ? p : x)));
      toast.ok(t.prompts.savedToast);
      void qc.invalidateQueries({ queryKey: qk.prompts });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.prompts.signInFirst
          : t.prompts.couldNotSave,
      ),
  });

  // DELETE — optimistic, rolls back on error.
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("prompts").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.prompts });
      const prev = qc.getQueryData<Prompt[]>(qk.prompts);
      setPrompts((old) => old.filter((p) => p.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.prompts.deletedToast),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setPrompts(ctx.prev);
      toast.err(t.prompts.couldNotDelete);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.prompts }),
  });

  // Seed the curated "Public" prompts, skipping any already in the library (by
  // name), so a repeat click never duplicates. Owned by the user, flagged public.
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

  const saving = createMutation.isPending || updateMutation.isPending;

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const name = form.name.trim();
    const description = form.description.trim();
    const body = form.body.trim();
    if (!name) {
      setFormError(t.prompts.nameRequired);
      return;
    }
    if (!body) {
      setFormError(t.prompts.bodyRequired);
      return;
    }
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, name, description, body, project_id: form.project_id, is_public: form.is_public },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createMutation.mutate(
        { name, description, body, project_id: form.project_id, is_public: form.is_public },
        { onSuccess: () => setDialogOpen(false) },
      );
    }
  }

  async function copyPrompt(p: Prompt) {
    try {
      await navigator.clipboard.writeText(p.body);
      setCopiedId(p.id);
      toast.ok(t.prompts.copied);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === p.id ? null : cur)),
        1500,
      );
    } catch {
      toast.err(t.prompts.couldNotCopy);
    }
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

  const mineFiltered = filtered.filter((p) => !p.is_public);
  const pubFiltered = filtered.filter((p) => p.is_public);
  const searching = query.trim().length > 0;
  const promptGrid = (list: Prompt[]) => (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((p) => (
        <PromptCard
          key={p.id}
          prompt={p}
          copied={copiedId === p.id}
          onCopy={() => copyPrompt(p)}
          onEdit={() => openEdit(p)}
          onDelete={() => removePrompt(p)}
        />
      ))}
    </div>
  );
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

  return (
    <div>
      <PageHeader
        title={t.prompts.title}
        description={t.prompts.description}
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t.prompts.newPrompt}
          </Button>
        }
      />

      {prompts.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <Input
            placeholder={t.prompts.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
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
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t.prompts.noMatches}
          description={t.prompts.noMatchesDescription}
          className="py-16"
        />
      ) : (
        <div className="space-y-8">
          {(mineFiltered.length > 0 || !searching) && (
            <PromptSection
              icon={MessageSquareText}
              title={t.prompts.mineSection}
              count={mineFiltered.length}
            >
              {mineFiltered.length > 0 ? (
                promptGrid(mineFiltered)
              ) : (
                <p className="text-sm text-foreground-subtle">
                  {t.prompts.noPromptsDescription}
                </p>
              )}
            </PromptSection>
          )}
          {(pubFiltered.length > 0 || !searching) && (
            <PromptSection
              icon={Sparkles}
              title={t.prompts.publicSection}
              desc={t.prompts.publicSectionDesc}
              count={pubFiltered.length}
              action={addCuratedButton}
            >
              {pubFiltered.length > 0 ? (
                promptGrid(pubFiltered)
              ) : (
                <p className="text-sm text-foreground-subtle">
                  {t.prompts.publicEmpty}
                </p>
              )}
            </PromptSection>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? t.prompts.editTitle : t.prompts.newTitle}
            </DialogTitle>
          </DialogHeader>
            <form onSubmit={submitForm} className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="prompt-name">{t.prompts.name}</Label>
                <Input
                  id="prompt-name"
                  value={form.name}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, name: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder={t.prompts.descriptionPlaceholder}
                  maxLength={160}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt-body">{t.prompts.promptText}</Label>
                <Textarea
                  id="prompt-body"
                  value={form.body}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, body: e.target.value }))
                  }
                  placeholder={t.prompts.promptPlaceholder}
                  rows={8}
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="prompt-project">{t.prompts.project}</Label>
                <SimpleSelect
                  id="prompt-project"
                  value={form.project_id}
                  onValueChange={(project_id) => setForm((current) => ({ ...current, project_id }))}
                  options={[
                    { value: "", label: t.prompts.noProject },
                    ...projects.map((project) => ({ value: project.id, label: project.name })),
                  ]}
                />
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
                  onCheckedChange={(is_public) =>
                    setForm((f) => ({ ...f, is_public }))
                  }
                />
              </div>
              {formError && (
                <p className="text-xs text-destructive">{formError}</p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <DialogClose asChild>
                  <Button type="button" variant="ghost" size="sm">
                    {t.prompts.cancel}
                  </Button>
                </DialogClose>
                <Button type="submit" size="sm" disabled={saving}>
                  <Check className="h-3.5 w-3.5" />
                  {saving
                    ? t.prompts.saving
                    : editing
                      ? t.prompts.save
                      : t.prompts.create}
                </Button>
              </div>
            </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A titled group of prompt cards (Mine / Public) with an optional description
 * and header action (e.g. "Add curated prompts"). */
function PromptSection({
  icon: Icon,
  title,
  desc,
  count,
  action,
  children,
}: {
  icon: typeof Sparkles;
  title: string;
  desc?: string;
  count: number;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-border pb-2">
        <h2 className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Icon className="h-3.5 w-3.5 text-foreground-muted" />
          {title}
        </h2>
        <span className="rounded-full bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold tabular text-foreground-muted">
          {count}
        </span>
        {desc && (
          <span className="text-xs text-foreground-subtle">{desc}</span>
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function PromptCard({
  prompt,
  copied,
  onCopy,
  onEdit,
  onDelete,
}: {
  prompt: Prompt;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  return (
    <motion.div
      layout
      className="group relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-soft transition-colors hover:border-border-strong"
    >
      {/* Title bar — slightly gray, with a divider off the content below. */}
      <div className="flex items-center gap-2 border-b border-border bg-surface-muted px-3 py-2">
        <h3
          className="min-w-0 flex-1 truncate text-xs font-semibold text-foreground"
          title={prompt.name}
        >
          {prompt.name}
        </h3>
        <Tooltip content={copied ? t.prompts.copied : t.prompts.copy}>
          <button
            type="button"
            onClick={onCopy}
            aria-label={t.prompts.copy}
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors focus-ring",
              copied
                ? "text-success"
                : "text-foreground-muted hover:bg-surface-hover hover:text-foreground",
            )}
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </button>
        </Tooltip>
      </div>

      {/* Content — a brief description of what the prompt does. The full body
          stays hidden until the edit dialog. The whole area copies the body. */}
      <button
        type="button"
        onClick={onCopy}
        aria-label={t.prompts.copy}
        title={t.prompts.copy}
        className="min-h-[64px] flex-1 cursor-copy px-3 pb-6 pt-2 text-left focus-ring"
      >
        {prompt.description?.trim() ? (
          <p className="line-clamp-3 text-[11px] leading-[15px] text-foreground-muted">
            {prompt.description}
          </p>
        ) : prompt.body?.trim() ? (
          // No description yet — fall back to a short preview of the body so the
          // card is never empty (the description can be added later).
          <p className="line-clamp-3 text-[11px] leading-[15px] text-foreground-subtle">
            {prompt.body.replace(/\s+/g, " ").trim()}
          </p>
        ) : (
          <p className="text-[11px] italic leading-[15px] text-foreground-subtle">
            {t.prompts.noDescription}
          </p>
        )}
      </button>

      {/* Edit / delete — tucked into the bottom-right, revealed on hover. */}
      <div className="absolute bottom-1.5 right-1.5 flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
        <Tooltip content={t.prompts.edit}>
          <button
            type="button"
            onClick={onEdit}
            aria-label={t.prompts.edit}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-foreground-muted backdrop-blur transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
          >
            <Pencil className="h-3 w-3" />
          </button>
        </Tooltip>
        <Tooltip content={t.prompts.delete}>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t.prompts.deletePrompt}
            className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-foreground-muted backdrop-blur transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </Tooltip>
      </div>
    </motion.div>
  );
}
