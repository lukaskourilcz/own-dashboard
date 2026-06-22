"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
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
import { qk } from "@/lib/queries/keys";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency } from "@/lib/utils";
import { useDict, useDateLocale } from "@/lib/i18n";
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
  const qc = useQueryClient();
  const t = useDict();
  const locale = useDateLocale();
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
    () =>
      monthlyTotals(transactions, displayCurrency, 6).map((m) => ({
        ...m,
        // Re-derive the axis label in the active locale (lib emits English).
        label: format(parseISO(`${m.month}-01`), t.finances.monthFormat, {
          locale,
        }),
      })),
    [transactions, displayCurrency, t, locale],
  );
  const categories = useMemo(() => {
    const labelFor = (name: string) =>
      name === "Uncategorized"
        ? t.finances.categoryUncategorized
        : name === "Subscriptions"
          ? t.finances.categorySubscriptions
          : name;
    return expenseByCategory(
      transactions,
      displayCurrency,
      subscriptions,
      currentMonthKey(),
    ).map((c) => ({ ...c, name: labelFor(c.name) }));
  }, [transactions, subscriptions, displayCurrency, t]);

  // CREATE transaction: needs the server-generated id, so apply state in
  // onSuccess (non-optimistic). Validation stays in the submit handler.
  const addTxMutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
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
      if (error) throw error;
      return data as Transaction;
    },
    onSuccess: (tx) => {
      setTransactions((prev) => [tx, ...prev]);
      setTxForm({ ...emptyTx, currency: txForm.currency });
      void qc.invalidateQueries({ queryKey: qk.transactions });
    },
    onError: (e: unknown) => {
      setError(
        e instanceof Error ? e.message : t.finances.amountRequired,
      );
    },
  });

  // Optimistic delete: drop the row from the cache immediately, roll back on
  // error, reconcile via invalidate once settled.
  const removeTxMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("transactions")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.transactions });
      const prev = qc.getQueryData<Transaction[]>(qk.transactions);
      setTransactions((old) => old.filter((tx) => tx.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setTransactions(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.transactions }),
  });

  // CREATE account: needs the server-generated id, so apply state in onSuccess.
  const addAccountMutation = useMutation({
    mutationFn: async () => {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");
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
      if (error) throw error;
      return data as Account;
    },
    onSuccess: (account) => {
      setAccounts((prev) => [...prev, account]);
      setAcctForm(emptyAccount);
      void qc.invalidateQueries({ queryKey: qk.accounts });
    },
  });

  function startEditAccount(a: Account) {
    setEditingAcct(a.id);
    setEditBuf({ name: a.name, balance: String(a.balance) });
  }

  // Optimistic update: the patch is applied to the cache before the await, so
  // snapshot first and roll back on error.
  const saveAccountMutation = useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { name: string; balance: number; updated_at: string };
    }) => {
      const { error } = await supabase
        .from("accounts")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: qk.accounts });
      const prev = qc.getQueryData<Account[]>(qk.accounts);
      setAccounts((old) =>
        old.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      );
      setEditingAcct(null);
      return { prev };
    },
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setAccounts(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.accounts }),
  });

  // Optimistic delete: drop the account from the cache immediately.
  const deleteAccountMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("accounts").delete().eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id) => {
      await qc.cancelQueries({ queryKey: qk.accounts });
      const prev = qc.getQueryData<Account[]>(qk.accounts);
      setAccounts((old) => old.filter((a) => a.id !== id));
      return { prev };
    },
    onError: (_e, _id, ctx) => {
      if (ctx?.prev) setAccounts(ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.accounts }),
  });

  function addTx(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setError(t.finances.amountRequired);
      return;
    }
    addTxMutation.mutate();
  }

  const removeTx = (id: string) => removeTxMutation.mutate(id);

  function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!acctForm.name.trim()) return;
    addAccountMutation.mutate();
  }

  function saveAccount(id: string) {
    const balance = Number(editBuf.balance);
    if (Number.isNaN(balance)) return;
    const patch = {
      name: editBuf.name.trim(),
      balance,
      updated_at: new Date().toISOString(),
    };
    saveAccountMutation.mutate({ id, patch });
  }

  const deleteAccount = (id: string) => deleteAccountMutation.mutate(id);

  return (
    <div>
      <PageHeader
        title={t.finances.title}
        description={t.finances.description}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Net worth */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> {t.finances.netWorth}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-3xl font-semibold tracking-tight tabular text-foreground">
              {formatCurrency(totalNet, displayCurrency)}
            </p>
            <p className="text-xs text-foreground-subtle mt-1">
              {t.finances.acrossAccounts(accounts.length)}
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
                            aria-label={t.common.save}
                          >
                            <Check className="h-3.5 w-3.5 text-success" />
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => setEditingAcct(null)}
                            aria-label={t.common.cancel}
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
                              <Tooltip content={t.common.edit}>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => startEditAccount(a)}
                                  aria-label={t.common.edit}
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                              </Tooltip>
                              <Tooltip content={t.common.delete}>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => deleteAccount(a.id)}
                                  aria-label={t.common.delete}
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
                placeholder={t.finances.accountNamePlaceholder}
                aria-label={t.finances.accountNamePlaceholder}
                value={acctForm.name}
                onChange={(e) =>
                  setAcctForm({ ...acctForm, name: e.target.value })
                }
              />
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Input
                  type="number"
                  step="0.01"
                  placeholder={t.finances.balancePlaceholder}
                  aria-label={t.finances.balancePlaceholder}
                  value={acctForm.balance}
                  onChange={(e) =>
                    setAcctForm({ ...acctForm, balance: e.target.value })
                  }
                />
                <Select
                  value={acctForm.currency}
                  aria-label={t.finances.ccy}
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
                <Plus className="h-3.5 w-3.5" /> {t.finances.addAccount}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Bar chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.finances.last6Months}</CardTitle>
          </CardHeader>
          <CardContent>
            {months.every((m) => m.income === 0 && m.expense === 0) ? (
              <EmptyState
                title={t.finances.noTransactionsYet}
                description={t.finances.addFewTransactions}
                className="py-10"
              />
            ) : (
              <div className="h-52 sm:h-64">
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
                      name={t.finances.income}
                      radius={[3, 3, 0, 0]}
                    />
                    <Bar
                      dataKey="expense"
                      fill="var(--destructive)"
                      name={t.finances.expense}
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
            <CardTitle>{t.finances.addTransaction}</CardTitle>
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
                  <ArrowDownRight className="h-3.5 w-3.5" /> {t.finances.expense}
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
                  <ArrowUpRight className="h-3.5 w-3.5" /> {t.finances.income}
                </button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="tx-amount">{t.finances.amount}</Label>
                  <Input
                    id="tx-amount"
                    type="number"
                    step="0.01"
                    value={txForm.amount}
                    onChange={(e) =>
                      setTxForm({ ...txForm, amount: e.target.value })
                    }
                    placeholder={t.finances.amountPlaceholder}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tx-currency">{t.finances.ccy}</Label>
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
                <Label htmlFor="tx-category">{t.finances.category}</Label>
                <Input
                  id="tx-category"
                  value={txForm.category}
                  onChange={(e) =>
                    setTxForm({ ...txForm, category: e.target.value })
                  }
                  placeholder={t.finances.categoryPlaceholder}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-date">{t.finances.date}</Label>
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
                  <Label htmlFor="tx-account">{t.finances.account}</Label>
                  <Select
                    id="tx-account"
                    value={txForm.account_id}
                    onChange={(e) =>
                      setTxForm({ ...txForm, account_id: e.target.value })
                    }
                  >
                    <option value="">{t.finances.noneOption}</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="tx-note">{t.finances.note}</Label>
                <Textarea
                  id="tx-note"
                  value={txForm.note}
                  onChange={(e) => setTxForm({ ...txForm, note: e.target.value })}
                  placeholder={t.finances.notePlaceholder}
                  rows={2}
                />
              </div>
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button type="submit" className="w-full">
                <Plus className="h-3.5 w-3.5" /> {t.common.add}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Categories */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.finances.thisMonthByCategory}</CardTitle>
          </CardHeader>
          <CardContent>
            {categories.length === 0 ? (
              <EmptyState
                title={t.finances.nothingThisMonth}
                description={t.finances.categorizeHint}
                className="py-10"
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 items-center">
                <div className="h-48 sm:h-56">
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
            <CardTitle>{t.finances.recentTransactions}</CardTitle>
          </CardHeader>
          <CardContent>
            {transactions.length === 0 ? (
              <EmptyState
                title={t.finances.noTransactionsYet}
                description={t.finances.addOnLeft}
              />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {transactions.slice(0, 20).map((tx) => (
                  <li
                    key={tx.id}
                    className="group flex items-center justify-between gap-3 px-2 py-2.5 row-hover"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span
                        className={
                          "h-7 w-7 rounded-md inline-flex items-center justify-center " +
                          (tx.kind === "income"
                            ? "bg-success/10 text-success"
                            : "bg-destructive/10 text-destructive")
                        }
                      >
                        {tx.kind === "income" ? (
                          <ArrowUpRight className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowDownRight className="h-3.5 w-3.5" />
                        )}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {tx.category ??
                            (tx.kind === "income"
                              ? t.finances.income
                              : t.finances.expense)}
                        </p>
                        <p className="text-[11px] text-foreground-subtle tabular">
                          {tx.occurred_on}
                          {tx.note ? ` · ${tx.note}` : ""}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={
                          "text-sm font-medium tabular " +
                          (tx.kind === "income"
                            ? "text-success"
                            : "text-destructive")
                        }
                      >
                        {tx.kind === "income" ? "+" : "−"}
                        {formatCurrency(tx.amount, tx.currency)}
                      </span>
                      <Tooltip content={t.common.delete}>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={() => removeTx(tx.id)}
                          aria-label={t.common.delete}
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
