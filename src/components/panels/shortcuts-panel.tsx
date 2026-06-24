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
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { useDict } from "@/lib/i18n";
import type {
  ReferenceKind,
  ReferenceRow,
  Shortcut,
  Updater,
} from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  shortcuts: Shortcut[];
  setShortcuts: Updater<Shortcut[]>;
  referenceRows: ReferenceRow[];
  setReferenceRows: Updater<ReferenceRow[]>;
};

type Form = { command: string; description: string };

const emptyForm: Form = { command: "", description: "" };

export function ShortcutsPanel({
  shortcuts,
  setShortcuts,
  referenceRows,
  setReferenceRows,
}: Props) {
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

      <SectionLabel className="mb-2">{t.shortcuts.myShortcuts}</SectionLabel>

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

      {/* Reference cheatsheets — editable; two-up on large screens. */}
      <div className="mt-8 grid items-start gap-4 lg:grid-cols-2">
        <EditableTable
          title={t.shortcuts.gitScripts}
          kind="git"
          columns={[
            { field: "c1", label: t.shortcuts.command, mono: true },
            { field: "c2", label: t.shortcuts.colDescription, grow: true },
          ]}
          rows={referenceRows}
          setReferenceRows={setReferenceRows}
        />
        <EditableTable
          title={t.shortcuts.translatedTitle}
          kind="translated"
          columns={[
            { field: "c1", label: t.shortcuts.colAction, grow: true },
            { field: "c2", label: t.shortcuts.colWindows, mono: true },
            { field: "c3", label: t.shortcuts.colMac, mono: true },
          ]}
          rows={referenceRows}
          setReferenceRows={setReferenceRows}
        />
        <EditableTable
          title={t.shortcuts.keySubstTitle}
          note={t.shortcuts.keySubstHint}
          kind="subst"
          columns={[
            { field: "c1", label: t.shortcuts.colWindows, mono: true },
            { field: "c2", label: t.shortcuts.colMac, grow: true },
          ]}
          rows={referenceRows}
          setReferenceRows={setReferenceRows}
        />
      </div>

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

type Column = {
  field: "c1" | "c2" | "c3";
  label: string;
  mono?: boolean; // sized to content (the short column, e.g. command/keys)
  grow?: boolean; // takes the rest and truncates to one line + tooltip
};

/** Editable reference table. One `kind` per table (git/subst/translated);
 * rows are filtered from the shared store. The `mono` column is sized to its
 * content (dynamic width); the `grow` column fills the rest and truncates,
 * with the full text on hover. */
function EditableTable({
  title,
  note,
  kind,
  columns,
  rows,
  setReferenceRows,
}: {
  title: string;
  note?: string;
  kind: ReferenceKind;
  columns: Column[];
  rows: ReferenceRow[];
  setReferenceRows: Updater<ReferenceRow[]>;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ReferenceRow | null>(null);
  const [form, setForm] = useState<{ c1: string; c2: string; c3: string }>({
    c1: "",
    c2: "",
    c3: "",
  });
  const [error, setError] = useState<string | null>(null);

  const mine = useMemo(() => rows.filter((r) => r.kind === kind), [rows, kind]);
  const hasC3 = columns.some((c) => c.field === "c3");

  const createMut = useMutation({
    mutationFn: async (vars: { c1: string; c2: string; c3: string | null }) => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
      const sortOrder = Math.max(0, ...mine.map((r) => r.sort_order)) + 1;
      const { data, error } = await supabase
        .from("reference_rows")
        .insert({
          user_id: userId,
          kind,
          c1: vars.c1,
          c2: vars.c2,
          c3: vars.c3,
          sort_order: sortOrder,
        })
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as ReferenceRow;
    },
    onSuccess: (r) => {
      setReferenceRows((prev) => [...prev, r]);
      toast.ok(t.shortcuts.rowAdded);
      void qc.invalidateQueries({ queryKey: qk.referenceRows });
    },
    onError: (e) =>
      toast.err(
        (e as Error)?.message === "no-user"
          ? t.shortcuts.signInFirst
          : t.shortcuts.couldNotSaveRow,
      ),
  });

  const updateMut = useMutation({
    mutationFn: async (vars: {
      id: string;
      c1: string;
      c2: string;
      c3: string | null;
    }) => {
      const { data, error } = await supabase
        .from("reference_rows")
        .update({
          c1: vars.c1,
          c2: vars.c2,
          c3: vars.c3,
          updated_at: new Date().toISOString(),
        })
        .eq("id", vars.id)
        .select()
        .single();
      if (error || !data) throw error ?? new Error("no-data");
      return data as ReferenceRow;
    },
    onSuccess: (r) => {
      setReferenceRows((prev) => prev.map((x) => (x.id === r.id ? r : x)));
      toast.ok(t.shortcuts.rowSaved);
      void qc.invalidateQueries({ queryKey: qk.referenceRows });
    },
    onError: () => toast.err(t.shortcuts.couldNotSaveRow),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("reference_rows")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.referenceRows });
      const prev = qc.getQueryData<ReferenceRow[]>(qk.referenceRows);
      setReferenceRows((old) => old.filter((r) => r.id !== id));
      return { prev };
    },
    onSuccess: () => toast.ok(t.shortcuts.rowDeleted),
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setReferenceRows(ctx.prev);
      toast.err(t.shortcuts.couldNotDeleteRow);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.referenceRows }),
  });

  const saving = createMut.isPending || updateMut.isPending;

  function openCreate() {
    setEditing(null);
    setForm({ c1: "", c2: "", c3: "" });
    setError(null);
    setOpen(true);
  }
  function openEdit(r: ReferenceRow) {
    setEditing(r);
    setForm({ c1: r.c1, c2: r.c2, c3: r.c3 ?? "" });
    setError(null);
    setOpen(true);
  }
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const c1 = form.c1.trim();
    if (!c1) {
      setError(t.shortcuts.rowRequired);
      return;
    }
    const c2 = form.c2.trim();
    const c3 = hasC3 ? form.c3.trim() || null : null;
    if (editing) {
      updateMut.mutate(
        { id: editing.id, c1, c2, c3 },
        { onSuccess: () => setOpen(false) },
      );
    } else {
      createMut.mutate({ c1, c2, c3 }, { onSuccess: () => setOpen(false) });
    }
  }
  function removeRow(r: ReferenceRow) {
    if (!window.confirm(t.shortcuts.deleteRowConfirm)) return;
    deleteMut.mutate(r.id);
  }

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex items-start justify-between gap-2 border-b border-border bg-surface-muted px-3 py-2">
        <div className="min-w-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-foreground">
            {title}
          </h3>
          {note && (
            <p className="mt-0.5 text-[11px] text-foreground-subtle">{note}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={openCreate}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" />
          {t.shortcuts.addRow}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left">
              {columns.map((col) => (
                <th
                  key={col.field}
                  className="whitespace-nowrap px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-foreground-muted"
                >
                  {col.label}
                </th>
              ))}
              <th className="w-0" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {mine.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length + 1}
                  className="px-3 py-3 text-xs italic text-foreground-subtle"
                >
                  {t.shortcuts.tableEmpty}
                </td>
              </tr>
            ) : (
              mine.map((row) => (
                <tr key={row.id} className="group border-t border-border/60">
                  {columns.map((col) => {
                    const val = row[col.field] ?? "";
                    if (col.grow) {
                      return (
                        <td
                          key={col.field}
                          className="max-w-0 px-3 py-2 align-top"
                        >
                          <span
                            className="block truncate text-xs text-foreground-muted"
                            title={val || undefined}
                          >
                            {val}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.field}
                        className="whitespace-nowrap px-3 py-2 align-top font-mono text-[11px] text-foreground"
                      >
                        {val}
                      </td>
                    );
                  })}
                  <td className="w-0 whitespace-nowrap px-2 py-1 align-top">
                    <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                      <Tooltip content={t.shortcuts.edit}>
                        <button
                          type="button"
                          onClick={() => openEdit(row)}
                          aria-label={t.shortcuts.edit}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-foreground focus-ring"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </Tooltip>
                      <Tooltip content={t.shortcuts.delete}>
                        <button
                          type="button"
                          onClick={() => removeRow(row)}
                          aria-label={t.shortcuts.delete}
                          className="inline-flex h-6 w-6 items-center justify-center rounded text-foreground-subtle transition-colors hover:bg-surface-hover hover:text-destructive focus-ring"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog.Root open={open} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
          <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-surface p-5 shadow-elevated">
            <Dialog.Title className="text-sm font-semibold">
              {editing ? t.shortcuts.editRowTitle : t.shortcuts.addRow}
            </Dialog.Title>
            <form onSubmit={submit} className="mt-3 space-y-3">
              {columns.map((col) => (
                <div key={col.field} className="space-y-1.5">
                  <Label htmlFor={`rr-${kind}-${col.field}`}>{col.label}</Label>
                  <Input
                    id={`rr-${kind}-${col.field}`}
                    value={form[col.field]}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, [col.field]: e.target.value }))
                    }
                    autoFocus={col.field === "c1"}
                    className={col.mono ? "font-mono text-xs" : undefined}
                  />
                </div>
              ))}
              {error && <p className="text-xs text-destructive">{error}</p>}
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
    </Card>
  );
}
