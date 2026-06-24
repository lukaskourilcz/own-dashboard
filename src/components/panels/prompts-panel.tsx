"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Check,
  Copy,
  MessageSquareText,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import type { Prompt, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

// Generous cap so the tiny, line-clamped preview can fill the card with as
// much of the prompt as fits, without rendering an enormous body string.
const PREVIEW_LEN = 600;

/** A trimmed preview of the prompt body, with an ellipsis when truncated. */
function preview(body: string): string {
  const clean = body.trim();
  if (clean.length <= PREVIEW_LEN) return clean;
  return clean.slice(0, PREVIEW_LEN).trimEnd() + "…";
}

type Props = {
  prompts: Prompt[];
  setPrompts: Updater<Prompt[]>;
};

export function PromptsPanel({ prompts, setPrompts }: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Prompt | null>(null);
  const [form, setForm] = useState<{ name: string; body: string }>({
    name: "",
    body: "",
  });
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return prompts;
    return prompts.filter((p) =>
      `${p.name}\n${p.body}`.toLowerCase().includes(q),
    );
  }, [prompts, query]);

  function openCreate() {
    setEditing(null);
    setForm({ name: "", body: "" });
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(p: Prompt) {
    setEditing(p);
    setForm({ name: p.name, body: p.body });
    setFormError(null);
    setDialogOpen(true);
  }

  // CREATE — non-optimistic: the insert returns the row, which we prepend and
  // then reconcile with the server via invalidate.
  const createMutation = useMutation({
    mutationFn: async (vars: { name: string; body: string }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
      const { data, error } = await supabase
        .from("prompts")
        .insert({ user_id: userId, name: vars.name, body: vars.body })
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
    mutationFn: async (vars: { id: string; name: string; body: string }) => {
      const { data, error } = await supabase
        .from("prompts")
        .update({
          name: vars.name,
          body: vars.body,
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

  const saving = createMutation.isPending || updateMutation.isPending;

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
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, name, body },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createMutation.mutate(
        { name, body },
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

  function removePrompt(p: Prompt) {
    if (!window.confirm(t.prompts.deleteConfirm)) return;
    deleteMutation.mutate(p.id);
  }

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
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                {t.prompts.newPrompt}
              </Button>
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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
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
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-elevated">
            <Dialog.Title className="text-sm font-semibold">
              {editing ? t.prompts.editTitle : t.prompts.newTitle}
            </Dialog.Title>
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
              {formError && (
                <p className="text-xs text-destructive">{formError}</p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" size="sm">
                    {t.prompts.cancel}
                  </Button>
                </Dialog.Close>
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
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
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

      {/* Content — tiny text to pack in as much of the prompt as possible.
          The whole area is a click-to-copy target. */}
      <button
        type="button"
        onClick={onCopy}
        aria-label={t.prompts.copy}
        className="min-h-[64px] flex-1 cursor-copy px-3 pb-6 pt-2 text-left focus-ring"
      >
        <p className="line-clamp-[16] whitespace-pre-wrap break-words text-[6px] leading-[9px] text-foreground-muted">
          {preview(prompt.body)}
        </p>
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
