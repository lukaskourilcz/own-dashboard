"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import {
  CalendarClock,
  CreditCard,
  PauseCircle,
  Pencil,
  PlayCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { cn, formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import {
  daysUntilRenewal,
  isActive,
  toMonthlyIn,
  totalMonthlyIn,
  upcomingRenewals,
} from "@/lib/subscriptions";
import { SUPPORTED_CURRENCIES, convert } from "@/lib/fx";
import { CHART_COLORS } from "@/lib/chart-colors";
import { qk } from "@/lib/queries/keys";
import { SubscriptionIcon } from "@/components/subscriptions/subscription-icon";
import type { Subscription, Updater } from "@/lib/types";

// Recharts is heavy; load the donut only when this panel renders.
const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  { ssr: false, loading: () => <Skeleton className="h-full w-full" /> },
);

type FormState = {
  id?: string;
  name: string;
  amount: string;
  currency: string;
  billing_cycle: "monthly" | "yearly" | "weekly";
  category: string;
  next_billing_date: string;
};

const emptyForm: FormState = {
  name: "",
  amount: "",
  currency: "USD",
  billing_cycle: "monthly",
  category: "",
  next_billing_date: "",
};

export function SubscriptionsPanel({
  subs,
  setSubs,
  displayCurrency,
  setDisplayCurrency,
  compact = false,
}: {
  subs: Subscription[];
  setSubs: Updater<Subscription[]>;
  displayCurrency: string;
  setDisplayCurrency?: (next: string) => void;
  compact?: boolean;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const chartData = useMemo(
    () =>
      subs
        .filter(isActive)
        .map((s) => ({
          name: s.name,
          value: Number(toMonthlyIn(s, displayCurrency).toFixed(2)),
        })),
    [subs, displayCurrency],
  );
  const monthlyTotal = totalMonthlyIn(subs, displayCurrency);
  const yearlyTotal = monthlyTotal * 12;
  const renewals = useMemo(() => upcomingRenewals(subs, 30), [subs]);
  const activeCount = subs.filter(isActive).length;

  type SubPayload = {
    name: string;
    amount: number;
    currency: string;
    billing_cycle: FormState["billing_cycle"];
    category: string | null;
    next_billing_date: string | null;
  };

  const createMutation = useMutation({
    mutationFn: async (vars: { payload: SubPayload; userId: string }) => {
      const { data, error } = await supabase
        .from("subscriptions")
        .insert({ ...vars.payload, user_id: vars.userId })
        .select()
        .single();
      if (error) throw error;
      return data as Subscription;
    },
    onSuccess: (sub) => {
      setSubs((prev) => [sub, ...prev]);
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
    onError: (e) => {
      setError((e as Error).message);
      setForm(emptyForm);
    },
  });

  const updateMutation = useMutation({
    mutationFn: async (vars: { id: string; payload: SubPayload }) => {
      const { data, error } = await supabase
        .from("subscriptions")
        .update({ ...vars.payload, updated_at: new Date().toISOString() })
        .eq("id", vars.id)
        .select()
        .single();
      if (error) throw error;
      return data as Subscription;
    },
    onSuccess: (sub) => {
      setSubs((prev) => prev.map((s) => (s.id === sub.id ? sub : s)));
      setForm(emptyForm);
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
    onError: (e) => {
      setError((e as Error).message);
      setForm(emptyForm);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("subscriptions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_data, id) => {
      setSubs((prev) => prev.filter((s) => s.id !== id));
      void qc.invalidateQueries({ queryKey: qk.subscriptions });
    },
  });

  // Optimistic toggle: flip is_active in the cache immediately, roll back on
  // error, reconcile with the DB via invalidate once settled.
  const toggleMutation = useMutation({
    mutationFn: async (vars: { sub: Subscription; next: boolean }) => {
      const { error } = await supabase
        .from("subscriptions")
        .update({ is_active: vars.next, updated_at: new Date().toISOString() })
        .eq("id", vars.sub.id);
      if (error) throw error;
    },
    onMutate: async ({ sub, next }) => {
      await qc.cancelQueries({ queryKey: qk.subscriptions });
      const prev = qc.getQueryData<Subscription[]>(qk.subscriptions);
      setSubs((old) =>
        old.map((s) => (s.id === sub.id ? { ...s, is_active: next } : s)),
      );
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setSubs(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.subscriptions }),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.amount) {
      setError(t.subscriptions.nameAndAmountRequired);
      return;
    }
    const payload: SubPayload = {
      name: form.name.trim(),
      amount: Number(form.amount),
      currency: form.currency,
      billing_cycle: form.billing_cycle,
      category: form.category.trim() || null,
      next_billing_date: form.next_billing_date || null,
    };
    const userId = await currentUserId(supabase);
    if (!userId) {
      setError(t.quickAdd.signInFirst);
      return;
    }
    if (form.id) {
      updateMutation.mutate({ id: form.id, payload });
    } else {
      createMutation.mutate({ payload, userId });
    }
  }

  function handleDelete(id: string) {
    deleteMutation.mutate(id);
  }

  function toggleActive(sub: Subscription) {
    const next = !isActive(sub);
    toggleMutation.mutate({ sub, next });
  }

  function startEdit(sub: Subscription) {
    setForm({
      id: sub.id,
      name: sub.name,
      amount: String(sub.amount),
      currency: sub.currency,
      billing_cycle: sub.billing_cycle,
      category: sub.category ?? "",
      next_billing_date: sub.next_billing_date ?? "",
    });
  }

  if (compact) {
    // Always a detailed breakdown: every active service with its brand mark,
    // billing cadence, and cost (converted to the display currency), busiest
    // spend first. Cancelled subs sink to the bottom, dimmed.
    const ordered = [...subs].sort((a, b) => {
      const act = Number(isActive(b)) - Number(isActive(a));
      if (act) return act;
      return toMonthlyIn(b, displayCurrency) - toMonthlyIn(a, displayCurrency);
    });
    return (
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="inline-flex items-center gap-1.5">
            <CreditCard className="h-3 w-3" /> {t.subscriptions.compactTitle}
          </CardTitle>
          {subs.length > 0 && (
            <span className="text-xs text-foreground-subtle tabular">
              {t.subscriptions.perYearAndActive(
                formatCurrency(yearlyTotal, displayCurrency),
                activeCount,
              )}
            </span>
          )}
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title={t.subscriptions.noSubscriptions}
              description={t.subscriptions.trackRecurringSpend}
              className="py-6"
            />
          ) : (
            <>
              <p className="text-2xl font-semibold tabular tracking-tight">
                {formatCurrency(monthlyTotal, displayCurrency)}
                <span className="text-sm font-normal text-foreground-subtle ml-1">
                  {t.subscriptions.perMo}
                </span>
              </p>
              <ul className="mt-3 -mx-2 divide-y divide-border/70">
                {ordered.map((s) => {
                  const active = isActive(s);
                  const monthly = toMonthlyIn(s, displayCurrency);
                  return (
                    <li
                      key={s.id}
                      className={cn(
                        "flex items-center gap-3 px-2 py-2",
                        !active && "opacity-55",
                      )}
                    >
                      <SubscriptionIcon name={s.name} size={30} />
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "truncate text-sm font-medium text-foreground",
                            !active && "line-through",
                          )}
                        >
                          {s.name}
                        </p>
                        <p className="truncate text-[11px] text-foreground-subtle">
                          {t.subscriptions.cycle[s.billing_cycle]}
                          {s.next_billing_date
                            ? ` · ${t.subscriptions.nextOn(s.next_billing_date)}`
                            : ""}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-medium tabular text-foreground">
                          {formatCurrency(s.amount, s.currency)}
                        </p>
                        {s.billing_cycle !== "monthly" && (
                          <p className="text-[11px] text-foreground-subtle tabular">
                            {t.subscriptions.perMoApprox(
                              formatCurrency(monthly, displayCurrency),
                            )}
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title={t.subscriptions.title}
        description={t.subscriptions.description}
        action={
          setDisplayCurrency && (
            <div className="inline-flex items-center gap-2">
              <Label className="text-foreground-subtle">
                {t.subscriptions.displayIn}
              </Label>
              <SimpleSelect
                value={displayCurrency}
                onValueChange={(v) => setDisplayCurrency(v)}
                aria-label={t.subscriptions.displayIn}
                className="h-8 w-20 text-xs"
                options={SUPPORTED_CURRENCIES.map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
            </div>
          )
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>
              {form.id
                ? t.subscriptions.editSubscription
                : t.subscriptions.addSubscription}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="sub-name">{t.subscriptions.name}</Label>
                <Input
                  id="sub-name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder={t.subscriptions.namePlaceholder}
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="sub-amount">{t.subscriptions.amount}</Label>
                  <Input
                    id="sub-amount"
                    type="number"
                    step="0.01"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder={t.subscriptions.amountPlaceholder}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sub-currency">{t.subscriptions.currency}</Label>
                  <SimpleSelect
                    id="sub-currency"
                    value={form.currency}
                    onValueChange={(v) => setForm({ ...form, currency: v })}
                    options={SUPPORTED_CURRENCIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-cycle">{t.subscriptions.billingCycle}</Label>
                <SimpleSelect
                  id="sub-cycle"
                  value={form.billing_cycle}
                  onValueChange={(v) =>
                    setForm({
                      ...form,
                      billing_cycle: v as FormState["billing_cycle"],
                    })
                  }
                  options={[
                    { value: "monthly", label: t.subscriptions.cycle.monthly },
                    { value: "yearly", label: t.subscriptions.cycle.yearly },
                    { value: "weekly", label: t.subscriptions.cycle.weekly },
                  ]}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-category">{t.subscriptions.category}</Label>
                <Input
                  id="sub-category"
                  value={form.category}
                  onChange={(e) => setForm({ ...form, category: e.target.value })}
                  placeholder={t.subscriptions.categoryPlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-next">{t.subscriptions.nextBilling}</Label>
                <Input
                  id="sub-next"
                  type="date"
                  value={form.next_billing_date}
                  onChange={(e) =>
                    setForm({ ...form, next_billing_date: e.target.value })
                  }
                />
              </div>
              {error && (
                <p className="text-xs text-destructive">{error}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={saving} className="flex-1">
                  <Plus className="h-3.5 w-3.5" />
                  {form.id ? t.common.save : t.common.add}
                </Button>
                {form.id && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setForm(emptyForm)}
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
            <CardTitle>{t.subscriptions.monthlySpend}</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title={t.subscriptions.noActiveSubscriptions}
                description={
                  subs.length === 0
                    ? t.subscriptions.addFirstLeft
                    : t.subscriptions.allCancelled
                }
              />
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 items-center">
                <div className="h-48 sm:h-56">
                  <CategoryDonut
                    data={chartData}
                    currency={displayCurrency}
                    innerRadius={56}
                    outerRadius={92}
                  />
                </div>
                <div>
                  <p className="text-3xl font-semibold tracking-tight tabular">
                    {formatCurrency(monthlyTotal, displayCurrency)}
                  </p>
                  <p className="text-xs text-foreground-subtle">
                    {t.subscriptions.perMonth}
                  </p>
                  <p className="text-xs text-foreground-subtle mt-1 tabular">
                    {t.subscriptions.perYearApprox(
                      formatCurrency(yearlyTotal, displayCurrency),
                    )}
                  </p>
                  <ul className="mt-4 space-y-1.5">
                    {chartData.map((d, i) => (
                      <li
                        key={d.name}
                        className="flex items-center gap-2 text-xs"
                      >
                        <span
                          className="h-2 w-2 rounded-sm shrink-0"
                          style={{
                            background: CHART_COLORS[i % CHART_COLORS.length],
                          }}
                        />
                        <span className="flex-1 truncate text-foreground">
                          {d.name}
                        </span>
                        <span className="tabular text-foreground-muted">
                          {formatCurrency(d.value, displayCurrency)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <CalendarClock className="h-3 w-3" />
              {t.subscriptions.next30Days}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {renewals.length === 0 ? (
              <p className="text-xs text-foreground-subtle">
                {t.subscriptions.nothingBilling30}
              </p>
            ) : (
              <ul className="-mx-2">
                {renewals.map((s) => {
                  const days = daysUntilRenewal(s);
                  const soon = days !== null && days <= 3;
                  return (
                  <li
                    key={s.id}
                    className="flex items-center justify-between rounded-md px-2 py-2 row-hover"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="tabular text-xs text-foreground-subtle w-20 shrink-0">
                        {s.next_billing_date}
                      </span>
                      <SubscriptionIcon name={s.name} size={26} />
                      <span className="font-medium text-sm truncate">
                        {s.name}
                      </span>
                      {soon && days !== null && (
                        <span
                          className={cn(
                            "text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded shrink-0",
                            days <= 0
                              ? "bg-destructive/10 text-destructive"
                              : "bg-warning/10 text-warning",
                          )}
                        >
                          {days <= 0
                            ? t.subscriptions.tagToday
                            : days === 1
                              ? t.subscriptions.tagTomorrow
                              : t.subscriptions.tagInDays(days)}
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-foreground-muted shrink-0 tabular">
                      {formatCurrency(s.amount, s.currency)}
                      {s.currency !== displayCurrency && (
                        <span className="text-xs text-foreground-subtle ml-1">
                          ≈ {formatCurrency(
                            convert(s.amount, s.currency, displayCurrency),
                            displayCurrency,
                          )}
                        </span>
                      )}
                    </div>
                  </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t.subscriptions.allSubscriptions}</CardTitle>
          </CardHeader>
          <CardContent>
            {subs.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title={t.subscriptions.nothingHereYet}
                description={t.subscriptions.addFirstForm}
              />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {[...subs]
                  .sort((a, b) => Number(isActive(b)) - Number(isActive(a)))
                  .map((s) => {
                    const active = isActive(s);
                    return (
                      <li
                        key={s.id}
                        className={cn(
                          "group flex items-center justify-between gap-3 px-2 py-2.5 row-hover transition-opacity",
                          form.id === s.id && "bg-surface-muted",
                          !active && "opacity-60",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <SubscriptionIcon name={s.name} size={34} />
                          <div className="min-w-0">
                          <p
                            className={cn(
                              "font-medium text-sm truncate",
                              !active && "line-through",
                            )}
                          >
                            {s.name}
                            {!active && (
                              <SectionLabel className="ml-2 inline">
                                {t.subscriptions.cancelled}
                              </SectionLabel>
                            )}
                          </p>
                          <p className="text-xs text-foreground-subtle tabular">
                            {formatCurrency(s.amount, s.currency)} ·{" "}
                            {t.subscriptions.cycle[s.billing_cycle]}
                            {s.category ? ` · ${s.category}` : ""}
                            {s.next_billing_date
                              ? ` · ${t.subscriptions.nextOn(s.next_billing_date)}`
                              : ""}
                          </p>
                          </div>
                        </div>
                        <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                          <Tooltip content={t.common.edit}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => startEdit(s)}
                              aria-label={t.common.edit}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                          <Tooltip
                            content={
                              active
                                ? t.subscriptions.cancelSub
                                : t.subscriptions.reactivate
                            }
                          >
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => toggleActive(s)}
                              aria-label={
                                active
                                  ? t.subscriptions.cancelAria
                                  : t.subscriptions.reactivateAria
                              }
                            >
                              {active ? (
                                <PauseCircle className="h-3.5 w-3.5 text-warning" />
                              ) : (
                                <PlayCircle className="h-3.5 w-3.5 text-success" />
                              )}
                            </Button>
                          </Tooltip>
                          <Tooltip content={t.common.delete}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleDelete(s.id)}
                              aria-label={t.common.delete}
                            >
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </Tooltip>
                        </div>
                      </li>
                    );
                  })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

