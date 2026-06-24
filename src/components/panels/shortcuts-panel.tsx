"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "framer-motion";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Copy, Pencil, Plus, Search, Terminal, Trash2 } from "lucide-react";
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
import type { Shortcut, Updater } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  shortcuts: Shortcut[];
  setShortcuts: Updater<Shortcut[]>;
};

type Form = { command: string; description: string };

const emptyForm: Form = { command: "", description: "" };

export function ShortcutsPanel({ shortcuts, setShortcuts }: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Shortcut | null>(null);
  const [form, setForm] = useState<Form>(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shortcuts;
    return shortcuts.filter((s) =>
      `${s.command}\n${s.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [shortcuts, query]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(s: Shortcut) {
    setEditing(s);
    setForm({ command: s.command, description: s.description ?? "" });
    setFormError(null);
    setDialogOpen(true);
  }

  const createMutation = useMutation({
    mutationFn: async (vars: { command: string; description: string | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
      const sortOrder =
        Math.max(0, ...shortcuts.map((s) => s.sort_order)) + 1;
      const { data, error } = await supabase
        .from("shortcuts")
        .insert({
          user_id: userId,
          command: vars.command,
          description: vars.description,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Shortcut;
    },
    onSuccess: (s) => {
      setShortcuts((prev) => [...prev, s]);
      toast.ok(t.shortcuts.createdToast);
      void qc.invalidateQueries({ queryKey: qk.shortcuts });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.shortcuts.signInFirst
          : t.shortcuts.couldNotSave,
      ),
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: {
      id: string;
      command: string;
      description: string | null;
    }) => {
      const { data, error } = await supabase
        .from("shortcuts")
        .update({
          command: vars.command,
          description: vars.description,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as Shortcut;
    },
    onSuccess: (s) => {
      setShortcuts((prev) => prev.map((x) => (x.id === s.id ? s : x)));
      toast.ok(t.shortcuts.savedToast);
      void qc.invalidateQueries({ queryKey: qk.shortcuts });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.shortcuts.signInFirst
          : t.shortcuts.couldNotSave,
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("shortcuts").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.shortcuts });
      const prev = qc.getQueryData<Shortcut[]>(qk.shortcuts);
      setShortcuts((old) => old.filter((s) => s.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.shortcuts.deletedToast),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setShortcuts(ctx.prev);
      toast.err(t.shortcuts.couldNotDelete);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.shortcuts }),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  function submitForm(e: React.FormEvent) {
    e.preventDefault();
    const command = form.command.trim();
    if (!command) {
      setFormError(t.shortcuts.commandRequired);
      return;
    }
    const description = form.description.trim() || null;
    if (editing) {
      updateMutation.mutate(
        { id: editing.id, command, description },
        { onSuccess: () => setDialogOpen(false) },
      );
    } else {
      createMutation.mutate(
        { command, description },
        { onSuccess: () => setDialogOpen(false) },
      );
    }
  }

  async function copyShortcut(s: Shortcut) {
    try {
      await navigator.clipboard.writeText(s.command);
      setCopiedId(s.id);
      toast.ok(t.shortcuts.copied);
      window.setTimeout(
        () => setCopiedId((cur) => (cur === s.id ? null : cur)),
        1500,
      );
    } catch {
      toast.err(t.shortcuts.couldNotCopy);
    }
  }

  function removeShortcut(s: Shortcut) {
    if (!window.confirm(t.shortcuts.deleteConfirm)) return;
    deleteMutation.mutate(s.id);
  }

  return (
    <div>
      <PageHeader
        title={t.shortcuts.title}
        description={t.shortcuts.description}
        action={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5" />
            {t.shortcuts.addShortcut}
          </Button>
        }
      />

      {shortcuts.length > 0 && (
        <div className="relative mb-4 max-w-sm">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
          <Input
            placeholder={t.shortcuts.searchPlaceholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-9 pl-8 text-sm"
          />
        </div>
      )}

      {shortcuts.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={Terminal}
            title={t.shortcuts.noShortcutsYet}
            description={t.shortcuts.noShortcutsDescription}
            action={
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                {t.shortcuts.addShortcut}
              </Button>
            }
            className="py-16"
          />
        </Card>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t.shortcuts.noMatches}
          description={t.shortcuts.noMatchesDescription}
          className="py-16"
        />
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {filtered.map((s) => (
            <ShortcutCell
              key={s.id}
              shortcut={s}
              copied={copiedId === s.id}
              onCopy={() => copyShortcut(s)}
              onEdit={() => openEdit(s)}
              onDelete={() => removeShortcut(s)}
            />
          ))}
        </div>
      )}

      <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-elevated">
            <Dialog.Title className="text-sm font-semibold">
              {editing ? t.shortcuts.editTitle : t.shortcuts.newTitle}
            </Dialog.Title>
            <form onSubmit={submitForm} className="mt-3 space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="shortcut-command">{t.shortcuts.command}</Label>
                <Textarea
                  id="shortcut-command"
                  value={form.command}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, command: e.target.value }))
                  }
                  placeholder={t.shortcuts.commandPlaceholder}
                  rows={2}
                  autoFocus
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="shortcut-description">
                  {t.shortcuts.descriptionLabel}
                </Label>
                <Input
                  id="shortcut-description"
                  value={form.description}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, description: e.target.value }))
                  }
                  placeholder={t.shortcuts.descriptionPlaceholder}
                />
              </div>
              {formError && (
                <p className="text-xs text-destructive">{formError}</p>
              )}
              <div className="flex items-center justify-end gap-2 pt-1">
                <Dialog.Close asChild>
                  <Button type="button" variant="ghost" size="sm">
                    {t.shortcuts.cancel}
                  </Button>
                </Dialog.Close>
                <Button type="submit" size="sm" disabled={saving}>
                  <Check className="h-3.5 w-3.5" />
                  {saving
                    ? t.shortcuts.saving
                    : editing
                      ? t.shortcuts.save
                      : t.shortcuts.create}
                </Button>
              </div>
            </form>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}

function ShortcutCell({
  shortcut,
  copied,
  onCopy,
  onEdit,
  onDelete,
}: {
  shortcut: Shortcut;
  copied: boolean;
  onCopy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  return (
    <motion.div layout className="group relative">
      <Tooltip content={shortcut.description || shortcut.command}>
        <button
          type="button"
          onClick={onCopy}
          aria-label={`${t.shortcuts.copy}: ${shortcut.command}`}
          className="flex h-full w-full cursor-copy items-start gap-1.5 rounded-md border border-border bg-surface px-2.5 py-2 pr-7 text-left shadow-soft transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring"
        >
          <span className="mt-px shrink-0">
            {copied ? (
              <Check className="h-3 w-3 text-success" />
            ) : (
              <Copy className="h-3 w-3 text-foreground-subtle" />
            )}
          </span>
          <code className="line-clamp-3 min-w-0 flex-1 break-words font-mono text-[11px] leading-snug text-foreground">
            {shortcut.command}
          </code>
        </button>
      </Tooltip>
      {/* Edit / delete — revealed on hover, on top of the copy button. */}
      <div className="absolute right-1 top-1 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <Tooltip content={t.shortcuts.edit}>
          <button
            type="button"
            onClick={onEdit}
            aria-label={t.shortcuts.edit}
            className={cn(
              "inline-flex h-5 w-5 items-center justify-center rounded bg-surface/80 text-foreground-subtle backdrop-blur transition-colors hover:bg-surface-hover hover:text-foreground focus-ring",
            )}
          >
            <Pencil className="h-3 w-3" />
          </button>
        </Tooltip>
        <Tooltip content={t.shortcuts.delete}>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t.shortcuts.deleteShortcut}
            className="inline-flex h-5 w-5 items-center justify-center rounded bg-surface/80 text-foreground-subtle backdrop-blur transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </Tooltip>
      </div>
    </motion.div>
  );
}
