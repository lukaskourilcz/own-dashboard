"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tooltip } from "@/components/ui/tooltip";
import { SimpleSelect } from "@/components/ui/select";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useUnsavedDraft } from "@/components/navigation-guard";
import { useDict } from "@/lib/i18n";
import { useSpendCategories } from "@/lib/use-spend-categories";
import { SPEND_CATEGORY_NAME_MAX, SpendCategoryError } from "@/lib/spend-category-records";
import type { SpendCategory } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Managed choices supplement existing entity labels; they never replace or
 * erase legacy free-text category values. Saves select only confirmed names. */
export function CategorySelect({ value, onChange, used = [], id, contextKey = id ?? "category", ariaLabel, className }: {
  value: string; onChange: (value: string) => void; used?: readonly (string | null)[];
  id?: string; contextKey?: string; ariaLabel?: string; className?: string;
}) {
  const t = useDict(), confirm = useConfirmation(), nameId = useId();
  const { categories, addCategory, removeCategory, ready, failed, loading, refreshing, reload, readOnly } = useSpendCategories();
  const [open, setOpen] = useState(false), [draft, setDraft] = useState(""), [action, setAction] = useState<"create" | "remove" | null>(null);
  const pending = action !== null;
  const [error, setError] = useState<"save" | "changed" | "context" | null>(null);
  const busy = useRef(false), mounted = useRef(false), latest = useRef({ contextKey, value, onChange });
  const nameInput = useRef<HTMLInputElement>(null), removalFocus = useRef<HTMLButtonElement | null>(null);
  useLayoutEffect(() => {
    if (pending || !removalFocus.current) return;
    const target = removalFocus.current; removalFocus.current = null;
    if (target.isConnected && !target.disabled) target.focus(); else nameInput.current?.focus();
  }, [pending]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useLayoutEffect(() => { latest.current = { contextKey, value, onChange }; }, [contextKey, value, onChange]);
  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    const put = (category: string | null | undefined) => {
      if (typeof category !== "string") return;
      const name = category.trim(); if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
    };
    categories.forEach(row => put(row.name)); used.forEach(put); put(value);
    return [...byKey.values()].sort((left, right) => left.localeCompare(right));
  }, [categories, used, value]);
  const selected = options.find(name => name.toLowerCase() === value.trim().toLowerCase()) ?? value;
  const valid = !!draft.trim() && draft.trim().length <= SPEND_CATEGORY_NAME_MAX;
  const finish = () => { busy.current = false; if (mounted.current) setAction(null); };
  async function createCategory(): Promise<boolean> {
    if (busy.current || !ready || !valid) return false;
    busy.current = true; setAction("create"); setError(null);
    const source = { contextKey, value };
    try {
      const row = await addCategory(draft.trim());
      if (!mounted.current) return false;
      if (latest.current.contextKey !== source.contextKey || latest.current.value !== source.value) { setError("context"); return false; }
      latest.current.onChange(row.name); setDraft(""); setOpen(false); return true;
    } catch { if (mounted.current) setError("save"); return false; }
    finally { finish(); }
  }
  async function remove(row: SpendCategory, trigger: HTMLButtonElement) {
    if (busy.current || !ready) return;
    const captured = structuredClone(row); removalFocus.current = trigger;
    busy.current = true; setAction("remove"); setError(null);
    try {
      const accepted = await confirm({ title: t.categories.removeTitle, description: t.categories.removeDescription(captured.name), confirmLabel: t.categories.remove, cancelLabel: t.common.cancel, destructive: true });
      if (!accepted || !mounted.current) return;
      await removeCategory(captured);
    } catch (failure) { if (mounted.current) setError(failure instanceof SpendCategoryError && failure.reason === "changed" ? "changed" : "save"); }
    finally { finish(); }
  }
  useUnsavedDraft({ dirty: !!draft.trim(), get pending() { return busy.current; }, canSave: ready && valid && !pending,
    save: createCategory, discard: () => { if (!busy.current) { setDraft(""); setError(null); setOpen(false); } } });
  const issue = failed ? t.categories.loadErr : error === "context" ? t.categories.contextChanged : error === "changed" ? t.categories.changed : error ? t.categories.saveErr : null;

  return <>
    <div className={cn("flex items-center gap-1.5", className)}>
      <SimpleSelect id={id} aria-label={ariaLabel} value={selected} onValueChange={next => { if (!busy.current) onChange(next); }} disabled={pending}
        placeholder={t.categories.placeholder} className="flex-1" options={[{ value: "", label: t.categories.none }, ...options.map(name => ({ value: name, label: name }))]} />
      <Tooltip content={t.categories.manage}><Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setOpen(true)} aria-label={t.categories.manage} disabled={pending}><Plus className="h-4 w-4" /></Button></Tooltip>
    </div>
    <Dialog open={open} onOpenChange={next => { if (!busy.current) setOpen(next); }}>
      <DialogContent className="sm:max-w-sm" aria-busy={pending} showClose={!pending} onEscapeKeyDown={event => { if (busy.current) event.preventDefault(); }} onPointerDownOutside={event => { if (busy.current) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t.categories.manageTitle}</DialogTitle><DialogDescription>{t.categories.manageDesc}</DialogDescription></DialogHeader>
        <form onSubmit={event => { event.preventDefault(); event.stopPropagation(); void createCategory(); }} className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
          <div className="min-w-0 space-y-1.5"><Label htmlFor={nameId}>{t.categories.newName}</Label><Input ref={nameInput} id={nameId} autoFocus value={draft} disabled={pending || readOnly} maxLength={SPEND_CATEGORY_NAME_MAX} onChange={event => setDraft(event.target.value)} placeholder={t.categories.newPlaceholder} /></div>
          <Button type="submit" disabled={pending || !ready || !valid}><Plus className="h-3.5 w-3.5" />{action === "create" ? t.common.unsaved.saving : t.categories.create}</Button>
        </form>
        {readOnly && <p role="status" className="text-xs text-foreground-muted">{t.categories.readOnly}</p>}
        {loading && <p role="status" className="text-xs text-foreground-muted">{t.common.loading}</p>}
        {issue && <div role="alert" className="space-y-2 text-xs text-risk"><p>{issue}</p><Button type="button" variant="outline" disabled={pending || refreshing} onClick={() => void reload().then(result => { if (mounted.current && result?.isSuccess) setError(null); })}>{t.common.retry}</Button></div>}
        {categories.length === 0 && ready && <p className="text-center text-xs text-foreground-subtle">{t.categories.empty}</p>}
        {categories.length > 0 && <ul className="-mx-1 max-h-64 space-y-0.5 overflow-y-auto px-1" aria-label={t.categories.manageTitle}>
          {categories.map(row => <li key={row.id} className="flex items-center gap-1">
            <button type="button" disabled={pending || !ready} onClick={() => { if (!busy.current) { onChange(row.name); setDraft(""); setError(null); setOpen(false); } }}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover focus-ring disabled:opacity-60 md:min-h-8">
              <span className="grid h-4 w-4 shrink-0 place-items-center">{row.name.toLowerCase() === value.trim().toLowerCase() && <Check className="h-3.5 w-3.5" />}</span><span className="min-w-0 flex-1 break-words">{row.name}</span>
            </button>
            <Button type="button" variant="ghost" size="icon" disabled={pending || !ready} onClick={event => void remove(row, event.currentTarget)} aria-label={`${t.categories.deleteAria}: ${row.name}`}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
          </li>)}
        </ul>}
      </DialogContent>
    </Dialog>
  </>;
}
