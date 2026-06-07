"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import { Gift, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { buildOccurrences, countdownLabel } from "@/lib/important-dates";
import { todayKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
import type { ImportantDate, RecurrenceUnit, Updater } from "@/lib/types";
import { partnerDisplayName, type CoupleContext } from "@/lib/couple";

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
  the_date: todayKey(),
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
  const occurrences = useMemo(() => buildOccurrences(dates), [dates]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.the_date) {
      toast.err("Title and date are required.");
      return;
    }
    const payload = {
      user_id: userId,
      couple_id: form.shareWithPartner && ctx.couple ? ctx.couple.id : null,
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
    <div>
      <PageHeader
        title="Dates"
        description="Anniversaries, birthdays, and deadlines."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Gift className="h-3 w-3" />
              {form.id ? "Edit date" : "Add a date"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ind-title">Title</Label>
                <Input
                  id="ind-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder="Anniversary"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5 col-span-2">
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
                <div className="space-y-1.5">
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
                <label className="inline-flex items-center gap-2 text-xs text-foreground-muted">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border-strong"
                    checked={form.is_recurring}
                    onChange={(e) =>
                      setForm({ ...form, is_recurring: e.target.checked })
                    }
                  />
                  Repeats
                </label>
                {form.is_recurring && (
                  <div className="space-y-1">
                    <Select
                      value={form.recurrence_unit}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          recurrence_unit: e.target.value as RecurrenceUnit,
                        })
                      }
                      className="h-7 w-28 text-xs"
                    >
                      <option value="yearly">Yearly</option>
                      <option value="monthly">Monthly</option>
                    </Select>
                  </div>
                )}
              </div>
              {ctx.couple && (
                <label className="inline-flex items-center gap-2 text-xs text-foreground-muted">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-border-strong"
                    checked={form.shareWithPartner}
                    onChange={(e) =>
                      setForm({ ...form, shareWithPartner: e.target.checked })
                    }
                  />
                  Share with {partnerDisplayName(ctx.partnerProfile, "partner")}
                </label>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ind-notes">Notes</Label>
                <Textarea
                  id="ind-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder="Optional"
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  <Plus className="h-3.5 w-3.5" />
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

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Coming up</CardTitle>
          </CardHeader>
          <CardContent>
            {occurrences.length === 0 ? (
              <EmptyState
                icon={Gift}
                title="No dates yet"
                description="Anniversaries, birthdays, deadlines — anything you don't want to miss."
              />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                <AnimatePresence initial={false}>
                  {occurrences.map((o) => {
                    const isOwn = o.date.user_id === userId;
                    const soon = o.daysUntil >= 0 && o.daysUntil <= 7;
                    return (
                      <motion.li
                        key={o.date.id}
                        layout
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0, height: 0 }}
                        className={cn(
                          "group flex items-center gap-3 px-2 py-2.5 row-hover transition-opacity",
                          o.daysUntil < 0 && "opacity-50",
                        )}
                      >
                        <div className="w-20 shrink-0 text-center">
                          <p
                            className={cn(
                              "text-xs font-medium tabular",
                              soon
                                ? "text-success"
                                : "text-foreground-muted",
                            )}
                          >
                            {countdownLabel(o.daysUntil)}
                          </p>
                          <p className="text-[10px] text-foreground-subtle tabular">
                            {format(o.next, "MMM d")}
                          </p>
                        </div>
                        <span className="text-xl shrink-0 leading-none">
                          {o.date.emoji ?? "📌"}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {o.date.title}
                            {o.date.couple_id && (
                              <span className="ml-2 text-[9px] uppercase tracking-wider text-success font-semibold">
                                shared
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-foreground-subtle">
                            {o.date.is_recurring
                              ? o.date.recurrence_unit === "monthly"
                                ? "every month"
                                : o.yearsCompleted !== null &&
                                    o.yearsCompleted > 0
                                  ? `turning ${o.yearsCompleted + 1}`
                                  : "yearly"
                              : "one-off"}
                            {o.date.notes ? ` · ${o.date.notes}` : ""}
                          </p>
                        </div>
                        {isOwn && (
                          <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip content="Edit">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => startEdit(o.date)}
                                aria-label="Edit"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                            <Tooltip content="Delete">
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => remove(o.date)}
                                aria-label="Delete"
                              >
                                <Trash2 className="h-3.5 w-3.5 text-destructive" />
                              </Button>
                            </Tooltip>
                          </div>
                        )}
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
