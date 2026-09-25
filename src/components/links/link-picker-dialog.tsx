"use client";

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { SimpleSelect } from "@/components/ui/select";
import { PricingDot } from "@/components/panels/link-library-card";
import { useDict } from "@/lib/i18n";
import { useReturnFocus } from "@/lib/use-return-focus";
import { filterLibrary, UNCATEGORIZED_LINKS } from "@/lib/link-library";
import type { AiCategory, AiLink } from "@/lib/types";

/** The picker shows the library in pages of this size. */
export const LINK_PICKER_PAGE = 50;

/**
 * Library picker shared by the project workspace, the prompt editor and the
 * Tools section: search plus a category filter over `filterLibrary`, bounded
 * pages of 50, and either several links (checkboxes) or one (radio buttons).
 * Links in `excludeIds` are already attached and are not offered.
 */
export function LinkPickerDialog({
  open,
  onOpenChange,
  links,
  categories,
  excludeIds,
  recordType,
  multiple = true,
  title,
  description,
  initialSelectedIds,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: AiLink[];
  categories: AiCategory[];
  excludeIds?: ReadonlySet<string>;
  /** Limit the picker to one record type (Tools pick links, never ideas). */
  recordType?: "link" | "idea";
  multiple?: boolean;
  title?: string;
  description?: string;
  /** Pre-selected links (for example the suggestions for a prompt's kind).
   * Read when the picker mounts; remount it with a new `key` to reset. */
  initialSelectedIds?: string[];
  onConfirm: (ids: string[]) => void | Promise<void>;
}) {
  const t = useDict();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [limit, setLimit] = useState(LINK_PICKER_PAGE);
  const [selected, setSelected] = useState<string[]>(() => initialSelectedIds ?? []);
  const [busy, setBusy] = useState(false);
  const returnFocus = useReturnFocus(open);

  const available = useMemo(
    () =>
      links.filter(
        (link) =>
          !excludeIds?.has(link.id) &&
          (!recordType || (link.record_type ?? "link") === recordType),
      ),
    [links, excludeIds, recordType],
  );
  const matches = useMemo(
    () => filterLibrary(available, categories, query, "all", category, "name"),
    [available, categories, query, category],
  );
  const shown = matches.slice(0, limit);
  const categoryName = new Map(categories.map((item) => [item.id, item.name]));

  function reset() {
    setQuery("");
    setCategory("all");
    setLimit(LINK_PICKER_PAGE);
    setSelected([]);
    setBusy(false);
  }

  function toggle(id: string, checked: boolean) {
    setSelected((previous) =>
      multiple
        ? checked
          ? [...previous, id]
          : previous.filter((item) => item !== id)
        : checked
          ? [id]
          : [],
    );
  }

  async function confirm() {
    if (selected.length === 0) return;
    setBusy(true);
    try {
      await onConfirm(selected);
      onOpenChange(false);
      reset();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="flex max-h-[90vh] flex-col gap-3 sm:max-w-xl" onCloseAutoFocus={returnFocus}>
        <DialogHeader>
          <DialogTitle>{title ?? t.ai.pickerTitle}</DialogTitle>
          <DialogDescription>
            {description ?? (multiple ? t.ai.pickerDescription : t.ai.pickerSingleDescription)}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="relative min-w-0">
            <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-muted" />
            <Input
              aria-label={t.ai.searchPlaceholder}
              placeholder={t.ai.searchPlaceholder}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setLimit(LINK_PICKER_PAGE);
              }}
              className="pl-8"
            />
          </div>
          <SimpleSelect
            aria-label={t.ai.category}
            value={category}
            onValueChange={(value) => {
              setCategory(value);
              setLimit(LINK_PICKER_PAGE);
            }}
            options={[
              { value: "all", label: t.ai.allCategories },
              ...categories.map((item) => ({ value: item.id, label: item.name })),
              { value: UNCATEGORIZED_LINKS, label: t.ai.uncategorized },
            ]}
          />
        </div>
        <p role="status" className="text-xs text-foreground-muted">
          {t.ai.pickerResults(matches.length)}
        </p>
        <div className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border">
          {shown.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-foreground-muted">{t.ai.pickerEmpty}</p>
          ) : (
            <ul
              className="divide-y divide-border"
              role={multiple ? undefined : "radiogroup"}
              aria-label={title ?? t.ai.pickerTitle}
            >
              {shown.map((link) => {
                const checked = selected.includes(link.id);
                const id = `link-picker-${link.id}`;
                return (
                  <li key={link.id}>
                    <label
                      htmlFor={id}
                      className="flex min-h-11 cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-surface-hover sm:min-h-9"
                    >
                      {multiple ? (
                        <Checkbox
                          id={id}
                          checked={checked}
                          onCheckedChange={(value) => toggle(link.id, value === true)}
                        />
                      ) : (
                        <input
                          id={id}
                          type="radio"
                          name="link-picker"
                          checked={checked}
                          onChange={(event) => toggle(link.id, event.target.checked)}
                          className="h-4 w-4 shrink-0 accent-[var(--primary)] focus-ring"
                        />
                      )}
                      <PricingDot pricing={link.pricing} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{link.title}</span>
                        <span className="block truncate text-[11px] text-foreground-muted">
                          {(link.category_id && categoryName.get(link.category_id)) || t.ai.uncategorized}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        {matches.length > shown.length && (
          <Button type="button" variant="outline" size="sm" onClick={() => setLimit((value) => value + LINK_PICKER_PAGE)}>
            {t.ai.pickerShowMore(shown.length, matches.length)}
          </Button>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t.common.cancel}
          </Button>
          <Button type="button" onClick={() => void confirm()} disabled={selected.length === 0 || busy}>
            {t.ai.pickerAdd(selected.length)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
