"use client";

import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { createClient } from "@/lib/supabase/client";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import {
  currentMonthKey,
  expenseByCategory,
  monthlyTotals,
  netWorth,
} from "@/lib/finances";
import { todayKey } from "@/lib/date-keys";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency } from "@/lib/utils";
import type { Account, Subscription, Transaction, Updater } from "@/lib/types";

type TxForm = {
  kind: "income" | "expense";
  amount: string;
  currency: string;
  category: string;
  note: string;
  occurred_on: string;
  account_id: string;
};

type AccountForm = { name: string; balance: string; currency: string };

const emptyTx: TxForm = {
  kind: "expense",
  amount: "",
  currency: "USD",
  category: "",
  note: "",
  occurred_on: todayKey(),
  account_id: "",
};

const emptyAccount: AccountForm = { name: "", balance: "0", currency: "USD" };

export function FinancesPanel({
  accounts,
  setAccounts,
  transactions,
  setTransactions,
  subscriptions,
  displayCurrency,
}: {
  accounts: Account[];
  setAccounts: Updater<Account[]>;
  transactions: Transaction[];
  setTransactions: Updater<Transaction[]>;
  subscriptions: Subscription[];
  displayCurrency: string;
}) {
  const supabase = createClient();
  const [txForm, setTxForm] = useState<TxForm>(emptyTx);
  const [acctForm, setAcctForm] = useState<AccountForm>(emptyAccount);
  const [editingAcct, setEditingAcct] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<{ name: string; balance: string }>({
    name: "",
    balance: "",
  });
  const [error, setError] = useState<string | null>(null);

  const totalNet = netWorth(accounts, displayCurrency);
  const months = useMemo(
    () => monthlyTotals(transactions, displayCurrency, 6),
    [transactions, displayCurrency],
  );
  const categories = useMemo(
    () =>
      expenseByCategory(
        transactions,
        displayCurrency,
        subscriptions,
        currentMonthKey(),
      ),
    [transactions, subscriptions, displayCurrency],
  );

  async function addTx(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setError("Amount is required.");
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { data, error } = await supabase
      .from("transactions")
      .insert({
        user_id: userId,
        account_id: txForm.account_id || null,
        kind: txForm.kind,
        amount: Number(txForm.amount),
        currency: txForm.currency,
        category: txForm.category.trim() || null,
        note: txForm.note.trim() || null,
        occurred_on: txForm.occurred_on,
      })
      .select()
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not save.");
      return;
    }
    setTransactions((prev) => [data, ...prev]);
    setTxForm({ ...emptyTx, currency: txForm.currency });
  }

  async function removeTx(id: string) {
    const { error } = await supabase.from("transactions").delete().eq("id", id);
    if (!error) setTransactions((prev) => prev.filter((t) => t.id !== id));
  }

  async function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!acctForm.name.trim()) return;
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { data, error } = await supabase
      .from("accounts")
      .insert({
        user_id: userId,
        name: acctForm.name.trim(),
        balance: Number(acctForm.balance || 0),
        currency: acctForm.currency,
      })
      .select()
      .single();
    if (!error && data) {
      setAccounts((prev) => [...prev, data]);
      setAcctForm(emptyAccount);
    }
  }

  function startEditAccount(a: Account) {
    setEditingAcct(a.id);
    setEditBuf({ name: a.name, balance: String(a.balance) });
  }

  async function saveAccount(id: string) {
    const balance = Number(editBuf.balance);
    if (Number.isNaN(balance)) return;
    const patch = {
      name: editBuf.name.trim(),
      balance,
      updated_at: new Date().toISOString(),
    };
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
    setEditingAcct(null);
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (error) {
      const { data } = await supabase
        .from("accounts")
        .select("*")
        .eq("id", id)
        .single();
      if (data) setAccounts((prev) => prev.map((a) => (a.id === id ? data : a)));
    }
  }

  async function deleteAccount(id: string) {
    const { error } = await supabase.from("accounts").delete().eq("id", id);
    if (!error) setAccounts((prev) => prev.filter((a) => a.id !== id));
  }

  return (
    <div>
      <PageHeader
        title="Finances"
        description="Accounts, transactions, and trends."
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Net worth */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> Net worth
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight tabular text-foreground">
              {formatCurrency(totalNet, displayCurrency)}
            </p>
            <p className="text-xs text-foreground-subtle mt-1">
              across {accounts.length} account
              {accounts.length === 1 ? "" : "s"}
            </p>

            {accounts.length > 0 && (
              <ul className="mt-4 -mx-2">
                {accounts.map((a) => {
                  const editing = editingAcct === a.id;
                  return (
                    <li
                      key={a.id}
                      className="group flex items-center justify-between gap-2 px-2 py-2 rounded-md row-hover"
                    >
                      {editing ? (
                        <div className="flex-1 flex gap-1 items-center">
                          <Input
                            value={editBuf.name}
                            onChange={(e) =>
                              setEditBuf({ ...editBuf, name: e.target.value })
                            }
                            className="h-7 flex-1 min-w-0 text-xs"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            value={editBuf.balance}
                            onChange={(e) =>
                              setEditBuf({ ...editBuf, balance: e.target.value })
                            }
                            className="h-7 w-24 text-xs"
                          />
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => saveAccount(a.id)}
                            aria-label="Save"
                          >
                            <Check className="h-3.5 w-3.5 text-success" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setEditingAcct(null)}
                            aria-label="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {a.name}
                            </p>
                            <p className="text-[11px] text-foreground-subtle tabular">
                              {a.currency}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-sm tabular text-foreground-muted">
                              {formatCurrency(a.balance, a.currency)}
                            </span>
                            <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                              <Tooltip content="Edit">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => startEditAccount(a)}
                                  aria-label="Edit"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </Tooltip>
                              <Tooltip content="Delete">
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => deleteAccount(a.id)}
                                  aria-label="Delete"
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </Tooltip>
                            </div>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            <form
              onSubmit={addAccount}
              className="mt-4 pt-4 border-t border-border space-y-2"
            >
              <Input
                placeholder="Account name"
                value={acctForm.name}
                onChange={(e) =>
                  setAcctForm({ ...acctForm, name: e.target.value })
                }
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Balance"
                  value={acctForm.balance}
                  onChange={(e) =>
                    setAcctForm({ ...acctForm, balance: e.target.value })
                  }
                />
                <Select
                  value={acctForm.currency}
                  onChange={(e) =>
                    setAcctForm({ ...acctForm, currency: e.target.value })
                  }
                >
                  {SUPPORTED_CURRENCIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="w-full"
              >
                <Plus className="h-3.5 w-3.5" /> Add account
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Last 6 months</CardTitle>
          </CardHeader>
          <CardContent>
            {months.every((m) => m.income === 0 && m.expense === 0) ? (
              <EmptyState
                title="No transactions yet"
                description="Add a few transactions to see income vs expense."
                className="py-10"
              />
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={months}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    barCategoryGap="25%"
                  >
                    <XAxis
                      dataKey="label"
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      stroke="var(--foreground-subtle)"
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      fontSize={11}
                      width={50}
                      stroke="var(--foreground-subtle)"
                    />
                    <RTooltip
                      cursor={{ fill: "var(--surface-hover)" }}
                      formatter={(value) =>
                        formatCurrency(Number(value), displayCurrency)
                      }
                      contentStyle={chartTooltipStyle}
                    />
                    <Legend
                      iconType="circle"
                      iconSize={8}
                      wrapperStyle={{ fontSize: 11 }}
                    />
                    <Bar
                      dataKey="income"
                      fill="var(--success)"
                      name="Income"
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="expense"
                      fill="var(--destructive)"
                      name="Expense"
                      radius={[3, 3, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add transaction */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Add transaction</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={addTx} className="space-y-3">
              <div className="grid grid-cols-2 gap-2 p-0.5 rounded-md bg-surface-muted">
                <button
                  type="button"
                  onClick={() => setTxForm({ ...txForm, kind: "expense" })}
                  className={
                    "inline-flex items-center justify-center gap-1.5 rounded text-xs font-medium py-1.5 transition-colors " +
                    (txForm.kind === "expense"
                      ? "bg-surface text-foreground shadow-soft"
                      : "text-foreground-muted hover:text-foreground")
                  }
                >
                  <ArrowDownRight className="h-3.5 w-3.5" /> Expense
                </button>
                <button
                  type="button"
                  onClick={() => setTxForm({ ...txForm, kind: "income" })}
                  className={
                    "inline-flex items-center justify-center gap-1.5 rounded text-xs font-medium py-1.5 transition-colors " +
                    (txForm.kind === "income"
                      ? "bg-surface text-foreground shadow-soft"
                      : "text-foreground-muted hover:text-foreground")
                  }
                >
                  <ArrowUpRight className="h-3.5 w-3.5" /> Income
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1.5 col-span-2">
                  <Label htmlFor="tx-amount">Amount</Label>
                  <Input
                    id="tx-amount"
                    type="number"
                    step="0.01"
                    value={txForm.amount}
                    onChange={(e) =>
                      setTxForm({ ...txForm, amount: e.target.value })
                    }
                    placeholder="12.50"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tx-currency">CCY</Label>
                  <Select
                    id="tx-currency"
                    value={txForm.currency}
                    onChange={(e) =>
                      setTxForm({ ...txForm, currency: e.target.value })
                    }
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
                <Label htmlFor="tx-category">Category</Label>
                <Input
                  id="tx-category"
                  value={txForm.category}
                  onChange={(e) =>
                    setTxForm({ ...txForm, category: e.target.value })
                  }
                  placeholder="Groceries"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-date">Date</Label>
                <Input
                  id="tx-date"
                  type="date"
                  value={txForm.occurred_on}
                  onChange={(e) =>
                    setTxForm({ ...txForm, occurred_on: e.target.value })
                  }
                />
              </div>
              {accounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-account">Account</Label>
                  <Select
                    id="tx-account"
                    value={txForm.account_id}
                    onChange={(e) =>
                      setTxForm({ ...txForm, account_id: e.target.value })
                    }
                  >
                    <option value="">— None —</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="tx-note">Note</Label>
                <Textarea
                  id="tx-note"
                  value={txForm.note}
                  onChange={(e) => setTxForm({ ...txForm, note: e.target.value })}
                  placeholder="Optional"
                  rows={2}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" className="w-full">
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Categories */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>This month by category</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <EmptyState
                title="Nothing this month"
                description="Categorize transactions to see the breakdown."
                className="py-10"
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 items-center">
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={categories}
                        dataKey="value"
                        nameKey="name"
                        innerRadius={45}
                        outerRadius={85}
                        paddingAngle={1.5}
                        stroke="var(--surface)"
                        strokeWidth={2}
                      >
                        {categories.map((_, i) => (
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
                <ul className="space-y-1.5 text-sm">
                  {categories.map((c, i) => (
                    <li key={c.name} className="flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-sm shrink-0"
                        style={{
                          background: CHART_COLORS[i % CHART_COLORS.length],
                        }}
                      />
                      <span className="flex-1 truncate text-foreground">
                        {c.name}
                      </span>
                      <span className="text-foreground-muted tabular">
                        {formatCurrency(c.value, displayCurrency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Transactions list */}
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Recent transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <EmptyState
                title="No transactions yet"
                description="Add a transaction on the left."
              />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {transactions.slice(0, 20).map((t) => (
                  <li
                    key={t.id}
                    className="group flex items-center justify-between gap-3 px-2 py-2.5 row-hover"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={
                          "h-7 w-7 rounded-md inline-flex items-center justify-center " +
                          (t.kind === "income"
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive")
                        }
                      >
                        {t.kind === "income" ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {t.category ??
                            (t.kind === "income" ? "Income" : "Expense")}
                        </p>
                        <p className="text-[11px] text-foreground-subtle tabular">
                          {t.occurred_on}
                          {t.note ? ` · ${t.note}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={
                          "text-sm font-medium tabular " +
                          (t.kind === "income"
                            ? "text-success"
                            : "text-destructive")
                        }
                      >
                        {t.kind === "income" ? "+" : "−"}
                        {formatCurrency(t.amount, t.currency)}
                      </span>
                      <Tooltip content="Delete">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => removeTx(t.id)}
                          aria-label="Delete"
                          className="opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </Tooltip>
                    </div>
                  </li>
                ))}
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
