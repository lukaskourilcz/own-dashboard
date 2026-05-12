"use client";

import { useMemo, useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { createClient } from "@/lib/supabase/client";
import { cn, formatCurrency } from "@/lib/utils";
import { toMonthly } from "@/lib/subscriptions";
import type { Subscription } from "@/lib/types";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

const COLORS = [
  "#6366f1",
  "#ec4899",
  "#10b981",
  "#f59e0b",
  "#3b82f6",
  "#ef4444",
  "#8b5cf6",
  "#14b8a6",
  "#f97316",
  "#84cc16",
];

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
  compact = false,
}: {
  subs: Subscription[];
  setSubs: Updater<Subscription[]>;
  compact?: boolean;
}) {
  const supabase = createClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chartData = useMemo(
    () =>
      subs.map((s) => ({
        name: s.name,
        value: Number(toMonthly(s).toFixed(2)),
        currency: s.currency,
      })),
    [subs],
  );
  const monthlyTotal = chartData.reduce((acc, d) => acc + d.value, 0);
  const yearlyTotal = monthlyTotal * 12;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim() || !form.amount) {
      setError("Name and amount are required.");
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
      setError("Not authenticated.");
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
          <CardTitle>Subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <p className="text-sm text-zinc-500">No subscriptions yet.</p>
          ) : (
            <>
              <p className="text-2xl font-semibold">
                {formatCurrency(monthlyTotal)}
                <span className="text-sm font-normal text-zinc-500 ml-1">/mo</span>
              </p>
              <p className="text-xs text-zinc-500">
                {formatCurrency(yearlyTotal)} per year · {subs.length} active
              </p>
              <div className="mt-3 h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={35}
                      outerRadius={60}
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>{form.id ? "Edit subscription" : "Add subscription"}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="sub-name">Name</Label>
              <Input
                id="sub-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Netflix"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="sub-amount">Amount</Label>
                <Input
                  id="sub-amount"
                  type="number"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: e.target.value })}
                  placeholder="9.99"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sub-currency">Currency</Label>
                <Select
                  id="sub-currency"
                  value={form.currency}
                  onChange={(e) => setForm({ ...form, currency: e.target.value })}
                >
                  <option value="USD">USD</option>
                  <option value="EUR">EUR</option>
                  <option value="GBP">GBP</option>
                  <option value="CZK">CZK</option>
                  <option value="CAD">CAD</option>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-cycle">Billing cycle</Label>
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
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
                <option value="weekly">Weekly</option>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-category">Category</Label>
              <Input
                id="sub-category"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Entertainment"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="sub-next">Next billing date</Label>
              <Input
                id="sub-next"
                type="date"
                value={form.next_billing_date}
                onChange={(e) =>
                  setForm({ ...form, next_billing_date: e.target.value })
                }
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={saving} className="flex-1">
                <Plus className="h-4 w-4" />
                {form.id ? "Save" : "Add"}
              </Button>
              {form.id && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setForm(emptyForm)}
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
          <CardTitle>Spending overview</CardTitle>
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Add your first subscription to see the breakdown.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 items-center">
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={55}
                      outerRadius={95}
                      paddingAngle={2}
                    >
                      {chartData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div>
                <p className="text-3xl font-bold">
                  {formatCurrency(monthlyTotal)}
                </p>
                <p className="text-sm text-zinc-500">per month</p>
                <p className="text-xs text-zinc-400 mt-1">
                  ≈ {formatCurrency(yearlyTotal)} per year
                </p>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {chartData.map((d, i) => (
                    <li key={d.name} className="flex items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 rounded-sm shrink-0"
                        style={{ background: COLORS[i % COLORS.length] }}
                      />
                      <span className="flex-1 truncate">{d.name}</span>
                      <span className="text-zinc-500">
                        {formatCurrency(d.value)}/mo
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>All subscriptions</CardTitle>
        </CardHeader>
        <CardContent>
          {subs.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing here yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {subs.map((s) => (
                <li
                  key={s.id}
                  className={cn(
                    "flex items-center justify-between py-2.5 gap-3",
                    form.id === s.id && "bg-zinc-50 dark:bg-zinc-900",
                  )}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{s.name}</p>
                    <p className="text-xs text-zinc-500">
                      {formatCurrency(s.amount, s.currency)} ·{" "}
                      {s.billing_cycle}
                      {s.category ? ` · ${s.category}` : ""}
                      {s.next_billing_date
                        ? ` · next ${s.next_billing_date}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => startEdit(s)}
                      aria-label="Edit"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(s.id)}
                      aria-label="Delete"
                    >
                      <Trash2 className="h-4 w-4 text-red-500" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
