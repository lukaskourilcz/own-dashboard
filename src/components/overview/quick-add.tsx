"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Sparkles, CornerDownLeft } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import type { InboxItem, Todo, Updater } from "@/lib/types";

type Props = {
  setTodos: Updater<Todo[]>;
  setInboxItems: Updater<InboxItem[]>;
  onCalendarTitle: (title: string) => void;
};

type NlAction =
  | { kind: "todo"; title: string; due_date?: string }
  | { kind: "inbox"; title: string; summary?: string }
  | {
      kind: "calendar_event";
      title: string;
      date: string;
      startTime?: string;
      endTime?: string;
      allDay?: boolean;
      description?: string;
    };

export function QuickAdd({
  setTodos,
  setInboxItems,
  onCalendarTitle,
}: Props) {
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  // Non-optimistic create: we need the server-assigned id before touching the
  // cache, so mirror the reference todos `addMutation`.
  const addTodoMutation = useMutation({
    mutationFn: async (vars: {
      userId: string;
      title: string;
      dueDate?: string;
    }) => {
      const { data, error } = await supabase
        .from("todos")
        .insert({
          title: vars.title,
          user_id: vars.userId,
          due_date: vars.dueDate ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Todo;
    },
    onSuccess: (todo) => {
      setTodos((prev) => [todo, ...prev]);
      void qc.invalidateQueries({ queryKey: qk.todos });
    },
  });

  const addInboxMutation = useMutation({
    mutationFn: async (vars: { userId: string; title: string; summary?: string }) => {
      const { data, error } = await supabase
        .from("inbox_items")
        .insert({
          user_id: vars.userId,
          title: vars.title,
          summary: vars.summary ?? null,
          source_type: "quick_add",
          suggested_destination: "task",
        })
        .select()
        .single();
      if (error) throw error;
      return data as InboxItem;
    },
    onSuccess: (item) => {
      setInboxItems((prev) => [item, ...prev]);
      void qc.invalidateQueries({ queryKey: qk.inboxItems });
    },
  });

  async function addTodoLocal(userId: string, title: string, dueDate?: string) {
    try {
      await addTodoMutation.mutateAsync({ userId, title, dueDate });
    } catch (error) {
      toast.err(
        error instanceof Error ? error.message : t.quickAdd.couldNotAddTodo,
      );
      return false;
    }
    toast.ok(t.quickAdd.addedTodo(title));
    return true;
  }

  async function addInboxLocal(userId: string, title: string, summary?: string) {
    try {
      await addInboxMutation.mutateAsync({ userId, title, summary });
    } catch (error) {
      toast.err(
        error instanceof Error ? error.message : t.quickAdd.couldNotAddInbox,
      );
      return false;
    }
    toast.ok(t.quickAdd.addedInbox(title));
    return true;
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = value.trim();
    if (!v) return;

    setBusy(true);
    try {
      const userId = await currentUserId(supabase);
      if (!userId) {
        toast.err(t.quickAdd.signInFirst);
        return;
      }

      // Explicit prefixes always win — fast path, predictable, works offline.
      if (v.startsWith("!todo ")) {
        const title = v.slice("!todo ".length).trim();
        if (!title) {
          toast.err(t.quickAdd.titleRequired);
          return;
        }
        if (await addTodoLocal(userId, title)) setValue("");
        return;
      }
      if (v.startsWith("!inbox ")) {
        const title = v.slice("!inbox ".length).trim();
        if (!title) {
          toast.err(t.quickAdd.titleRequired);
          return;
        }
        if (await addInboxLocal(userId, title)) setValue("");
        return;
      }
      if (v.startsWith("!cal ")) {
        const title = v.slice("!cal ".length).trim();
        if (!title) {
          toast.err(t.quickAdd.eventTitleRequired);
          return;
        }
        onCalendarTitle(title);
        setValue("");
        toast.info(t.quickAdd.openedCalendarForm);
        return;
      }

      // Otherwise: natural language via /api/quick-add → Claude Haiku tool-use.
      const tz =
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : undefined;
      let parsed: { action: NlAction | null; disabled?: boolean } | null = null;
      try {
        const res = await fetch("/api/quick-add", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: v, timezone: tz }),
        });
        if (res.ok) parsed = await res.json();
      } catch {
        // Treat network errors as "no parse".
      }

      if (parsed?.disabled) {
        toast.err(t.quickAdd.nlOff);
        return;
      }
      if (!parsed?.action) {
        toast.err(t.quickAdd.couldntParse);
        return;
      }

      const a = parsed.action;
      if (a.kind === "todo") {
        if (window.confirm(t.quickAdd.confirmTodo(a.title)) && await addTodoLocal(userId, a.title, a.due_date)) setValue("");
      } else if (a.kind === "inbox") {
        if (window.confirm(t.quickAdd.confirmInbox(a.title)) && await addInboxLocal(userId, a.title, a.summary)) setValue("");
      } else if (a.kind === "calendar_event") {
        // Hand off to the existing calendar route; surface the prefilled form
        // so the user can confirm before creating the GCal event.
        onCalendarTitle(a.title);
        setValue("");
        toast.info(
          t.quickAdd.openingCalendarForm(a.title, a.date, a.startTime),
        );
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="relative">
      <Sparkles className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground-subtle" />
      <Input
        ref={inputRef}
        id="quick-add-input"
        placeholder={t.quickAdd.placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={busy}
        className="pl-9 pr-20 h-10 text-sm"
      />
      <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 text-foreground-subtle">
        <kbd className="inline-flex h-5 items-center rounded border border-border bg-surface-muted px-1.5 text-[10px] font-medium">
          n
        </kbd>
        <CornerDownLeft className="h-3 w-3" />
      </div>
    </form>
  );
}
