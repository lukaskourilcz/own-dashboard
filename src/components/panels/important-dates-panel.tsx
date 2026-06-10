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
import { buildOccurrences } from "@/lib/important-dates";
import { todayKey } from "@/lib/date-keys";
import { cn } from "@/lib/utils";
import { useDict, useDateLocale, type Dict } from "@/lib/i18n";
import type { ImportantDate, RecurrenceUnit, Updater } from "@/lib/types";
import { partnerDisplayName, type CoupleContext } from "@/lib/couple";

/** Localized mirror of countdownLabel from @/lib/important-dates. */
function countdownLabelLocalized(daysUntil: number, t: Dict): string {
  if (daysUntil === 0) return t.dates.today;
  if (daysUntil === 1) return t.dates.tomorrow;
  if (daysUntil < 0) return t.dates.daysAgo(-daysUntil);
  if (daysUntil < 14) return t.dates.inDays(daysUntil);
  if (daysUntil < 60) return t.dates.inWeeks(Math.round(daysUntil / 7));
  return t.dates.inMonths(Math.round(daysUntil / 30));
}

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
  const t = useDict();
  const locale = useDateLocale();
  const [form, setForm] = useState<FormState>(empty);
  const occurrences = useMemo(() => buildOccurrences(dates), [dates]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.the_date) {
      toast.err(t.dates.titleAndDateRequired);
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
        toast.err(error?.message ?? t.dates.couldNotSave);
        return;
      }
      setDates((prev) => prev.map((d) => (d.id === data.id ? data : d)));
      toast.ok(t.dates.updated);
    } else {
      const { data, error } = await supabase
        .from("important_dates")
        .insert(payload)
        .select()
        .single();
      if (error || !data) {
        toast.err(error?.message ?? t.dates.couldNotSave);
        return;
      }
      setDates((prev) => [data, ...prev]);
      toast.ok(t.dates.added(data.title));
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
        title={t.dates.title}
        description={t.dates.description}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Gift className="h-3 w-3" />
              {form.id ? t.dates.editDate : t.dates.addDate}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={save} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ind-title">{t.dates.titleLabel}</Label>
                <Input
                  id="ind-title"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  placeholder={t.dates.titlePlaceholder}
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="ind-date">{t.dates.date}</Label>
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
                  <Label htmlFor="ind-emoji">{t.dates.emoji}</Label>
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
                  {t.dates.repeats}
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
                      <option value="yearly">{t.dates.yearly}</option>
                      <option value="monthly">{t.dates.monthly}</option>
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
                  {t.dates.shareWith(
                    partnerDisplayName(ctx.partnerProfile, t.dates.partnerFallback),
                  )}
                </label>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="ind-notes">{t.dates.notes}</Label>
                <Textarea
                  id="ind-notes"
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  placeholder={t.dates.notesPlaceholder}
                  rows={2}
                />
              </div>
              <div className="flex gap-2">
                <Button type="submit" className="flex-1">
                  <Plus className="h-3.5 w-3.5" />
                  {form.id ? t.common.save : t.common.add}
                </Button>
                {form.id && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm(empty)}
                  >
                    {t.common.cancel}
                  </Button>
                )}
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.dates.comingUp}</CardTitle>
          </CardHeader>
          <CardContent>
            {occurrences.length === 0 ? (
              <EmptyState
                icon={Gift}
                title={t.dates.noDatesYet}
                description={t.dates.noDatesYetDescription}
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
                            {countdownLabelLocalized(o.daysUntil, t)}
                          </p>
                          <p className="text-[10px] text-foreground-subtle tabular">
                            {format(o.next, t.dates.nextDateFormat, { locale })}
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
                                {t.dates.shared}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-foreground-subtle">
                            {o.date.is_recurring
                              ? o.date.recurrence_unit === "monthly"
                                ? t.dates.everyMonth
                                : o.yearsCompleted !== null &&
                                    o.yearsCompleted > 0
                                  ? t.dates.turning(o.yearsCompleted + 1)
                                  : t.dates.yearlyLabel
                              : t.dates.oneOff}
                            {o.date.notes ? ` · ${o.date.notes}` : ""}
                          </p>
                        </div>
                        {isOwn && (
                          <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip content={t.common.edit}>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => startEdit(o.date)}
                                aria-label={t.common.edit}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </Tooltip>
                            <Tooltip content={t.common.delete}>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                onClick={() => remove(o.date)}
                                aria-label={t.common.delete}
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
