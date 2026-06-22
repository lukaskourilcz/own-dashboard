"use client";

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { GcalCalendarEntry } from "@/app/api/calendar/list/route";

async function fetchCalendars(): Promise<GcalCalendarEntry[]> {
  const r = await fetch("/api/calendar/list");
  if (!r.ok) throw new Error(`status ${r.status}`);
  const d = (await r.json()) as { calendars: GcalCalendarEntry[] };
  return d.calendars;
}

export function CalendarPicker({
  initialSelected,
}: {
  initialSelected: string[];
}) {
  const t = useDict();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(
    new Set(initialSelected.length > 0 ? initialSelected : ["primary"]),
  );

  // Calendars load the first time the popover opens; React Query dedupes and
  // keeps them for 5 min, so reopening is instant (no re-fetch per open).
  const {
    data: calendars,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.calendarList,
    queryFn: fetchCalendars,
    enabled: open,
    staleTime: 5 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/user/preferences", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ selected_calendar_ids: [...selected] }),
      });
      if (!res.ok) throw new Error("save failed");
    },
    onSuccess: () => {
      toast.ok(t.calendar.selectionSaved);
      setOpen(false);
    },
    onError: () => toast.err(t.calendar.couldNotSaveSelection),
  });

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Always keep at least one calendar selected. Snap to primary if empty.
      if (next.size === 0) next.add("primary");
      return next;
    });
  }

  const label =
    selected.size === 1 && selected.has("primary")
      ? t.calendar.primaryLabel
      : t.calendar.countSelected(selected.size);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs font-medium text-foreground-muted hover:text-foreground hover:border-border-strong transition-colors focus-ring"
        >
          <Layers className="h-3 w-3" />
          {label}
          <ChevronDown className="h-3 w-3" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          className="z-40 w-72 rounded-lg border border-border bg-surface p-1.5 shadow-elevated"
        >
          <p className="px-2 pt-1.5 pb-1 text-[10px] uppercase tracking-wider text-foreground-subtle">
            {t.calendar.calendarsToShow}
          </p>
          {isLoading && (
            <p className="px-3 py-3 text-xs text-foreground-subtle">
              {t.calendar.loading}
            </p>
          )}
          {isError && (
            <p className="px-3 py-3 text-xs text-foreground-subtle">
              {t.calendar.couldNotLoadCalendars}
            </p>
          )}
          {!isLoading && !isError && calendars?.length === 0 && (
            <p className="px-3 py-3 text-xs text-foreground-subtle">
              {t.calendar.noCalendarsFound}
            </p>
          )}
          {!isLoading && calendars && calendars.length > 0 && (
            <ul className="max-h-72 overflow-y-auto">
              {calendars.map((c) => {
                const isOn = selected.has(c.primary ? "primary" : c.id);
                const key = c.primary ? "primary" : c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => toggle(key)}
                      className={cn(
                        "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-left transition-colors",
                        isOn
                          ? "text-foreground"
                          : "text-foreground-muted hover:text-foreground hover:bg-surface-hover",
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{
                          background: c.backgroundColor ?? "var(--border-strong)",
                        }}
                      />
                      <span className="flex-1 truncate">
                        {c.summary}
                        {c.primary && (
                          <span className="ml-1 text-[10px] text-foreground-subtle">
                            {t.calendar.primary}
                          </span>
                        )}
                      </span>
                      {isOn && (
                        <Check className="h-3.5 w-3.5 text-foreground" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="flex items-center justify-end gap-1.5 border-t border-border mt-1 pt-1.5 px-1.5 pb-0.5">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t.calendar.cancel}
            </Button>
            <Button
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={saveMutation.isPending}
            >
              {saveMutation.isPending ? t.calendar.saving : t.calendar.save}
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
