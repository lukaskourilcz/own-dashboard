"use client";

import { useState } from "react";
import { format } from "date-fns";
import { Gift, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { buildOccurrences, countdownLabel } from "@/lib/important-dates";
import { cn } from "@/lib/utils";
import type { ImportantDate, RecurrenceUnit } from "@/lib/types";
import type { CoupleContext } from "@/lib/couple";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

type FormState = {
  id?: string;
  title: string;
  the_date: string;
  is_recurring: boolean;
  recurrence_unit: RecurrenceUnit;
  emoji: string;
  notes: string;
  shareWithPartner: boolean;
};

const empty: FormState = {
  title: "",
  the_date: format(new Date(), "yyyy-MM-dd"),
  is_recurring: true,
  recurrence_unit: "yearly",
  emoji: "",
  notes: "",
  shareWithPartner: true,
};

export function ImportantDatesPanel({
  dates,
  setDates,
  userId,
  ctx,
}: {
  dates: ImportantDate[];
  setDates: Updater<ImportantDate[]>;
  userId: string;
  ctx: CoupleContext;
}) {
  const supabase = createClient();
  const toast = useToast();
  const [form, setForm] = useState<FormState>(empty);
  const occurrences = buildOccurrences(dates);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.the_date) {
      toast.err("Title and date are required.");
      return;
    }
    const payload = {
      user_id: userId,
      couple_id:
        form.shareWithPartner && ctx.couple ? ctx.couple.id : null,
      title: form.title.trim(),
      the_date: form.the_date,
      is_recurring: form.is_recurring,
      recurrence_unit: form.is_recurring ? form.recurrence_unit : null,
      emoji: form.emoji.trim() || null,
      notes: form.notes.trim() || null,
    };

    if (form.id) {
      const { data, error } = await supabase
        .from("important_dates")
        .update(payload)
        .eq("id", form.id)
        .select()
        .single();
      if (error || !data) {
        toast.err(error?.message ?? "Could not save.");
        return;
      }
      setDates((prev) => prev.map((d) => (d.id === data.id ? data : d)));
      toast.ok("Updated.");
    } else {
      const { data, error } = await supabase
        .from("important_dates")
        .insert(payload)
        .select()
        .single();
      if (error || !data) {
        toast.err(error?.message ?? "Could not save.");
        return;
      }
      setDates((prev) => [data, ...prev]);
      toast.ok(`Added "${data.title}".`);
    }
    setForm(empty);
  }

  function startEdit(d: ImportantDate) {
    setForm({
      id: d.id,
      title: d.title,
      the_date: d.the_date,
      is_recurring: d.is_recurring,
      recurrence_unit: d.recurrence_unit ?? "yearly",
      emoji: d.emoji ?? "",
      notes: d.notes ?? "",
      shareWithPartner: d.couple_id !== null,
    });
  }

  async function remove(d: ImportantDate) {
    setDates((prev) => prev.filter((x) => x.id !== d.id));
    const { error } = await supabase
      .from("important_dates")
      .delete()
      .eq("id", d.id);
    if (error) {
      setDates((prev) => [d, ...prev]);
      toast.err(error.message);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Gift className="h-4 w-4" />
              {form.id ? "Edit date" : "Add a date"}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="ind-title">Title</Label>
              <Input
                id="ind-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Anniversary"
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 col-span-2">
                <Label htmlFor="ind-date">Date</Label>
                <Input
                  id="ind-date"
                  type="date"
                  value={form.the_date}
                  onChange={(e) =>
                    setForm({ ...form, the_date: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ind-emoji">Emoji</Label>
                <Input
                  id="ind-emoji"
                  value={form.emoji}
                  onChange={(e) =>
                    setForm({ ...form, emoji: e.target.value })
                  }
                  placeholder="❤️"
                  maxLength={4}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-3 items-end">
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300"
                  checked={form.is_recurring}
                  onChange={(e) =>
                    setForm({ ...form, is_recurring: e.target.checked })
                  }
                />
                Repeats
              </label>
              {form.is_recurring && (
                <div className="space-y-1">
                  <Label htmlFor="ind-rec" className="text-xs">
                    Every
                  </Label>
                  <Select
                    id="ind-rec"
                    value={form.recurrence_unit}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        recurrence_unit: e.target.value as RecurrenceUnit,
                      })
                    }
                    className="h-8 w-28"
                  >
                    <option value="yearly">Year</option>
                    <option value="monthly">Month</option>
                  </Select>
                </div>
              )}
            </div>
            {ctx.couple && (
              <label className="inline-flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-zinc-300"
                  checked={form.shareWithPartner}
                  onChange={(e) =>
                    setForm({ ...form, shareWithPartner: e.target.checked })
                  }
                />
                Share with{" "}
                {ctx.partnerProfile?.display_name ??
                  ctx.partnerProfile?.email ??
                  "partner"}
              </label>
            )}
            <div className="space-y-1">
              <Label htmlFor="ind-notes">Notes</Label>
              <Textarea
                id="ind-notes"
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional"
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" className="flex-1">
                <Plus className="h-4 w-4" />
                {form.id ? "Save" : "Add"}
              </Button>
              {form.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForm(empty)}
                >
                  Cancel
                </Button>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Coming up</CardTitle>
        </CardHeader>
        <CardContent>
          {occurrences.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No dates yet. Add an anniversary, birthday, or any deadline you
              don&apos;t want to miss.
            </p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {occurrences.map((o) => {
                const isOwn = o.date.user_id === userId;
                const soon = o.daysUntil >= 0 && o.daysUntil <= 7;
                return (
                  <li
                    key={o.date.id}
                    className={cn(
                      "flex items-center gap-3 py-2.5",
                      o.daysUntil < 0 && "opacity-50",
                    )}
                  >
                    <div className="w-20 shrink-0 text-center">
                      <p
                        className={cn(
                          "text-xs font-mono font-medium",
                          soon
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-zinc-500",
                        )}
                      >
                        {countdownLabel(o.daysUntil)}
                      </p>
                      <p className="text-[10px] text-zinc-400">
                        {format(o.next, "MMM d, yyyy")}
                      </p>
                    </div>
                    <span className="text-2xl shrink-0">
                      {o.date.emoji ?? "📌"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {o.date.title}
                        {o.date.couple_id && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                            shared
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {o.date.is_recurring
                          ? o.date.recurrence_unit === "monthly"
                            ? "every month"
                            : o.yearsCompleted !== null && o.yearsCompleted > 0
                              ? `turning ${o.yearsCompleted + 1}`
                              : "yearly"
                          : "one-off"}
                        {o.date.notes ? ` · ${o.date.notes}` : ""}
                      </p>
                    </div>
                    {isOwn && (
                      <div className="flex gap-1 shrink-0">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEdit(o.date)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove(o.date)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
