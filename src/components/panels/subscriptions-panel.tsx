"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip as RTooltip } from "recharts";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
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
import type { Subscription, Updater } from "@/lib/types";

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
  const t = useDict();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.amount) {
      setError(t.subscriptions.nameAndAmountRequired);
      return;
    }
    setSaving(true);
    const payload = {
      name: form.name.trim(),
      amount: Number(form.amount),
      currency: form.currency,
      billing_cycle: form.billing_cycle,
      category: form.category.trim() || null,
      next_billing_date: form.next_billing_date || null,
    };
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) {
      setError(t.quickAdd.signInFirst);
      setSaving(false);
      return;
    }
    if (form.id) {
      const { data, error } = await supabase
        .from("subscriptions")
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq("id", form.id)
        .select()
        .single();
      if (error) setError(error.message);
      else setSubs((prev) => prev.map((s) => (s.id === data!.id ? data! : s)));
    } else {
      const { data, error } = await supabase
        .from("subscriptions")
        .insert({ ...payload, user_id: userId })
        .select()
        .single();
      if (error) setError(error.message);
      else if (data) setSubs((prev) => [data, ...prev]);
    }
    setSaving(false);
    setForm(emptyForm);
  }

  async function handleDelete(id: string) {
    const { error } = await supabase.from("subscriptions").delete().eq("id", id);
    if (!error) setSubs((prev) => prev.filter((s) => s.id !== id));
  }

  async function toggleActive(sub: Subscription) {
    const next = !isActive(sub);
    setSubs((prev) =>
      prev.map((s) => (s.id === sub.id ? { ...s, is_active: next } : s)),
    );
    const { error } = await supabase
      .from("subscriptions")
      .update({ is_active: next, updated_at: new Date().toISOString() })
      .eq("id", sub.id);
    if (error) {
      setSubs((prev) =>
        prev.map((s) => (s.id === sub.id ? { ...s, is_active: !next } : s)),
      );
    }
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
    return (
      <Card>
        <CardHeader>
          <CardTitle className="inline-flex items-center gap-1.5">
            <CreditCard className="h-3 w-3" /> {t.subscriptions.compactTitle}
          </CardTitle>
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
              <p className="text-xs text-foreground-subtle tabular">
                {t.subscriptions.perYearAndActive(
                  formatCurrency(yearlyTotal, displayCurrency),
                  activeCount,
                )}
              </p>
              {chartData.length > 0 && (
                <div className="mt-3 h-32 -mx-2">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={32}
                        outerRadius={56}
                        paddingAngle={1.5}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      >
                        {chartData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <RTooltip
                        formatter={(value) =>
                          formatCurrency(Number(value), displayCurrency)
                        }
                        contentStyle={chartTooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
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
              <Select
                value={displayCurrency}
                onChange={(e) => setDisplayCurrency(e.target.value)}
                className="h-8 w-20 text-xs"
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
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
                  <Select
                    id="sub-currency"
                    value={form.currency}
                    onChange={(e) => setForm({ ...form, currency: e.target.value })}
                  >
                    {SUPPORTED_CURRENCIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sub-cycle">{t.subscriptions.billingCycle}</Label>
                <Select
                  id="sub-cycle"
                  value={form.billing_cycle}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      billing_cycle: e.target.value as FormState["billing_cycle"],
                    })
                  }
                >
                  <option value="monthly">{t.subscriptions.cycle.monthly}</option>
                  <option value="yearly">{t.subscriptions.cycle.yearly}</option>
                  <option value="weekly">{t.subscriptions.cycle.weekly}</option>
                </Select>
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
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={chartData}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={56}
                        outerRadius={92}
                        paddingAngle={1.5}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      >
                        {chartData.map((_, i) => (
                          <Cell
                            key={i}
                            fill={CHART_COLORS[i % CHART_COLORS.length]}
                          />
                        ))}
                      </Pie>
                      <RTooltip
                        formatter={(value) =>
                          formatCurrency(Number(value), displayCurrency)
                        }
                        contentStyle={chartTooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
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

const chartTooltipStyle: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "8px",
  fontSize: "12px",
  boxShadow: "var(--shadow-card)",
  padding: "6px 10px",
};
