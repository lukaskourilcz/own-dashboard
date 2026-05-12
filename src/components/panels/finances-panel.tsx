"use client";

import { useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Bar,
  BarChart,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createClient } from "@/lib/supabase/client";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import {
  currentMonthKey,
  expenseByCategory,
  monthlyTotals,
  netWorth,
} from "@/lib/finances";
import { formatCurrency } from "@/lib/utils";
import type { Account, Subscription, Transaction } from "@/lib/types";

type Updater<T> = (next: T | ((prev: T) => T)) => void;

const SLICE_COLORS = [
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

const todayStr = () => format(new Date(), "yyyy-MM-dd");

const emptyTx: TxForm = {
  kind: "expense",
  amount: "",
  currency: "USD",
  category: "",
  note: "",
  occurred_on: todayStr(),
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
    // Optimistic
    setAccounts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...patch } : a)),
    );
    setEditingAcct(null);
    const { error } = await supabase.from("accounts").update(patch).eq("id", id);
    if (error) {
      // No clean rollback target — pull a fresh row from the server.
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
    <div className="grid gap-4 md:grid-cols-3">
      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>
            <span className="inline-flex items-center gap-1.5">
              <Wallet className="h-4 w-4" /> Net worth
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-bold">
            {formatCurrency(totalNet, displayCurrency)}
          </p>
          <p className="text-xs text-zinc-500 mt-1">
            across {accounts.length} account{accounts.length === 1 ? "" : "s"}
          </p>

          <ul className="mt-4 divide-y divide-zinc-100 dark:divide-zinc-800">
            {accounts.map((a) => {
              const editing = editingAcct === a.id;
              return (
                <li
                  key={a.id}
                  className="py-2 flex items-center justify-between gap-2"
                >
                  {editing ? (
                    <div className="flex-1 flex gap-1 items-center">
                      <Input
                        value={editBuf.name}
                        onChange={(e) =>
                          setEditBuf({ ...editBuf, name: e.target.value })
                        }
                        className="h-7 flex-1 min-w-0"
                      />
                      <Input
                        type="number"
                        step="0.01"
                        value={editBuf.balance}
                        onChange={(e) =>
                          setEditBuf({ ...editBuf, balance: e.target.value })
                        }
                        className="h-7 w-24"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => saveAccount(a.id)}
                        aria-label="Save"
                      >
                        <Check className="h-4 w-4 text-emerald-600" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setEditingAcct(null)}
                        aria-label="Cancel"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{a.name}</p>
                        <p className="text-xs text-zinc-500">{a.currency}</p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span className="text-sm tabular-nums">
                          {formatCurrency(a.balance, a.currency)}
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => startEditAccount(a)}
                          aria-label="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => deleteAccount(a.id)}
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-red-500" />
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>

          <form onSubmit={addAccount} className="mt-4 space-y-2">
            <p className="text-xs font-medium text-zinc-500">Add account</p>
            <Input
              placeholder="Account name"
              value={acctForm.name}
              onChange={(e) => setAcctForm({ ...acctForm, name: e.target.value })}
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
            <Button type="submit" variant="outline" size="sm" className="w-full">
              <Plus className="h-4 w-4" /> Add account
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>Last 6 months</CardTitle>
        </CardHeader>
        <CardContent>
          {months.every((m) => m.income === 0 && m.expense === 0) ? (
            <p className="text-sm text-zinc-500">
              Add transactions to see income vs. expense over time.
            </p>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={months}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                >
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis fontSize={12} width={60} />
                  <Tooltip
                    formatter={(value) =>
                      formatCurrency(Number(value), displayCurrency)
                    }
                  />
                  <Legend />
                  <Bar dataKey="income" fill="#10b981" name="Income" />
                  <Bar dataKey="expense" fill="#ef4444" name="Expense" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-1">
        <CardHeader>
          <CardTitle>Add transaction</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={addTx} className="space-y-3">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTxForm({ ...txForm, kind: "expense" })}
                className={
                  "flex-1 inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-sm border " +
                  (txForm.kind === "expense"
                    ? "border-red-500 text-red-600 bg-red-50 dark:bg-red-950/30"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500")
                }
              >
                <ArrowDownRight className="h-4 w-4" /> Expense
              </button>
              <button
                type="button"
                onClick={() => setTxForm({ ...txForm, kind: "income" })}
                className={
                  "flex-1 inline-flex items-center justify-center gap-1 rounded-md py-1.5 text-sm border " +
                  (txForm.kind === "income"
                    ? "border-emerald-500 text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30"
                    : "border-zinc-200 dark:border-zinc-800 text-zinc-500")
                }
              >
                <ArrowUpRight className="h-4 w-4" /> Income
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1 col-span-2">
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
              <div className="space-y-1">
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
            <div className="space-y-1">
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
            <div className="space-y-1">
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
              <div className="space-y-1">
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
            <div className="space-y-1">
              <Label htmlFor="tx-note">Note</Label>
              <Textarea
                id="tx-note"
                value={txForm.note}
                onChange={(e) => setTxForm({ ...txForm, note: e.target.value })}
                placeholder="Optional"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full">
              <Plus className="h-4 w-4" /> Add
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card className="md:col-span-2">
        <CardHeader>
          <CardTitle>This month by category</CardTitle>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No expenses this month yet.
            </p>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 items-center">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categories}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={85}
                      paddingAngle={2}
                    >
                      {categories.map((_, i) => (
                        <Cell key={i} fill={SLICE_COLORS[i % SLICE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) =>
                        formatCurrency(Number(value), displayCurrency)
                      }
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-1.5 text-sm">
                {categories.map((c, i) => (
                  <li key={c.name} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                    />
                    <span className="flex-1 truncate">{c.name}</span>
                    <span className="text-zinc-500 tabular-nums">
                      {formatCurrency(c.value, displayCurrency)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="md:col-span-3">
        <CardHeader>
          <CardTitle>Recent transactions</CardTitle>
        </CardHeader>
        <CardContent>
          {transactions.length === 0 ? (
            <p className="text-sm text-zinc-500">No transactions yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
              {transactions.slice(0, 20).map((t) => (
                <li
                  key={t.id}
                  className="py-2 flex items-center justify-between gap-3"
                >
                  <div className="min-w-0 flex items-center gap-3">
                    <span
                      className={
                        "h-6 w-6 rounded-md inline-flex items-center justify-center " +
                        (t.kind === "income"
                          ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400")
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
                        {t.category ?? (t.kind === "income" ? "Income" : "Expense")}
                      </p>
                      <p className="text-xs text-zinc-500">
                        {t.occurred_on}
                        {t.note ? ` · ${t.note}` : ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={
                        "text-sm font-medium tabular-nums " +
                        (t.kind === "income" ? "text-emerald-600" : "text-red-600")
                      }
                    >
                      {t.kind === "income" ? "+" : "−"}
                      {formatCurrency(t.amount, t.currency)}
                    </span>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => removeTx(t.id)}
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
