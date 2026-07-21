"use client";

import { useMemo, useState } from "react";
import { Check, Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { SimpleSelect } from "@/components/ui/select";
import { useDict } from "@/lib/i18n";
import { useSpendCategories } from "@/lib/use-prefs";
import { cn } from "@/lib/utils";

/**
 * A single-select category picker backed by a user-managed list (shared across
 * Subscriptions and Finances via `useSpendCategories`). The options are the
 * union of the managed list, any categories already present in the data
 * (`used`), and the current value — so pre-existing free-text categories keep
 * working. The "+" button opens a popup to create/delete categories; creating
 * one selects it immediately.
 */
export function CategorySelect({
  value,
  onChange,
  used = [],
  id,
  ariaLabel,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Categories already present in the data, so legacy values still show. */
  used?: readonly (string | null)[];
  id?: string;
  ariaLabel?: string;
  className?: string;
}) {
  const t = useDict();
  const { categories, addCategory, removeCategory } = useSpendCategories();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");

  // Union of managed + used-in-data + current value, de-duped case-insensitively
  // (keeping the first display spelling) and sorted for a stable menu.
  const options = useMemo(() => {
    const byKey = new Map<string, string>();
    const put = (c: string | null | undefined) => {
      const v = c?.trim();
      if (v && !byKey.has(v.toLowerCase())) byKey.set(v.toLowerCase(), v);
    };
    categories.forEach(put);
    used.forEach(put);
    put(value);
    return [...byKey.values()].sort((a, b) => a.localeCompare(b));
  }, [categories, used, value]);

  function createCategory(e: React.FormEvent) {
    e.preventDefault();
    const name = draft.trim();
    if (!name) return;
    addCategory(name); // no-op if it already exists (case-insensitive)
    onChange(name); // select the freshly created category
    setDraft("");
    setOpen(false);
  }

  return (
    <>
      <div className={cn("flex items-center gap-1.5", className)}>
        <SimpleSelect
          id={id}
          aria-label={ariaLabel}
          value={value}
          onValueChange={onChange}
          placeholder={t.categories.placeholder}
          className="flex-1"
          options={[
            { value: "", label: t.categories.none },
            ...options.map((c) => ({ value: c, label: c })),
          ]}
        />
        <Tooltip content={t.categories.manage}>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="shrink-0"
            onClick={() => setOpen(true)}
            aria-label={t.categories.manage}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </Tooltip>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t.categories.manageTitle}</DialogTitle>
            <DialogDescription>{t.categories.manageDesc}</DialogDescription>
          </DialogHeader>

          <form onSubmit={createCategory} className="mt-2 flex items-center gap-2">
            <Input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder={t.categories.newPlaceholder}
            />
            <Button type="submit" size="sm" disabled={!draft.trim()}>
              <Plus className="h-3.5 w-3.5" />
              {t.categories.create}
            </Button>
          </form>

          {categories.length === 0 ? (
            <p className="mt-4 text-center text-xs text-foreground-subtle">
              {t.categories.empty}
            </p>
          ) : (
            <ul className="mt-4 -mx-1 max-h-64 space-y-0.5 overflow-y-auto px-1">
              {categories.map((c) => {
                const selected = c === value;
                return (
                  <li key={c} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        onChange(c);
                        setOpen(false);
                      }}
                      className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-surface-hover focus-ring"
                    >
                      <span className="grid h-4 w-4 shrink-0 place-items-center">
                        {selected && <Check className="h-3.5 w-3.5" />}
                      </span>
                      <span className="flex-1 truncate">{c}</span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeCategory(c)}
                      aria-label={`${t.categories.deleteAria}: ${c}`}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
