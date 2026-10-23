"use client";

import { useId, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { format, parseISO } from "date-fns";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { CategorySelect } from "@/components/category-select";
import { Label } from "@/components/ui/label";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip } from "@/components/ui/tooltip";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import {
  currentMonthKey,
  expenseByCategory,
  monthlyTotals,
  netWorth,
} from "@/lib/finances";
import { todayKey } from "@/lib/date-keys";
import { qk } from "@/lib/queries/keys";
import { useNow } from "@/lib/use-now";
import { useToast } from "@/components/ui/toast";
import { CHART_COLORS } from "@/lib/chart-colors";
import { formatCurrency } from "@/lib/utils";
import { useDict, useDateLocale } from "@/lib/i18n";
import { BankSync } from "@/components/finances/bank-sync";
import { PaymentMatches } from "@/components/finances/payment-matches";
import { TransactionRules } from "@/components/finances/transaction-rules";
import type {
  Account,
  Cron,
  Invoice,
  InvoiceItem,
  Project,
  ProjectCost,
  Subscription,
  Transaction,
  Updater,
} from "@/lib/types";
import { CostOverview } from "@/components/cost-overview";

// Recharts is heavy; load the charts only when this panel renders so it stays
// out of the initial bundle. A skeleton fills the reserved height meanwhile.
const chartFallback = () => <Skeleton className="h-full w-full" />;
const MonthsBarChart = dynamic(
  () =>
    import("@/components/charts/months-bar-chart").then((m) => m.MonthsBarChart),
  { ssr: false, loading: chartFallback },
);
const CategoryDonut = dynamic(
  () =>
    import("@/components/charts/category-donut").then((m) => m.CategoryDonut),
  { ssr: false, loading: chartFallback },
);

type TxForm = {
  kind: "income" | "expense";
  amount: string;
  currency: string;
  category: string;
  note: string;
  occurred_on: string;
  account_id: string;
  project_id: string;
};

type AccountForm = { name: string; balance: string; currency: string };

const emptyTx: TxForm = {
  kind: "expense",
  amount: "",
  currency: "USD",
  category: "",
  note: "",
  occurred_on: "",
  account_id: "",
  project_id: "",
};

const emptyAccount: AccountForm = { name: "", balance: "0", currency: "USD" };

/** Compact in/out/net tile for the finance hero. */
function StatTile({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  tone: "success" | "destructive" | "neutral";
}) {
  const toneCls =
    tone === "success"
      ? "text-success"
      : tone === "destructive"
        ? "text-destructive"
        : "text-foreground-muted";
  return (
    <div className="rounded-xl border border-border bg-surface/70 px-2.5 py-2 text-left">
      <div className={`flex items-center gap-1 ${toneCls}`}>
        <Icon className="h-3 w-3" />
        <span className="text-[10px] font-semibold uppercase tracking-wider">
          {label}
        </span>
      </div>
      <p className="mt-1 text-sm font-semibold tabular text-foreground">
        {value}
      </p>
    </div>
  );
}

export function FinancesPanel({
  view = "overview",
  accounts,
  setAccounts,
  transactions,
  setTransactions,
  subscriptions,
  projects,
  projectCosts,
  crons,
  invoices,
  invoiceItems,
  displayCurrency,
}: {
  view?: "overview" | "accounts" | "transactions" | "categories";
  accounts: Account[];
  setAccounts: Updater<Account[]>;
  transactions: Transaction[];
  setTransactions: Updater<Transaction[]>;
  subscriptions: Subscription[];
  projects: Project[];
  projectCosts: ProjectCost[];
  crons: Cron[];
  /** Read-only here: the unmatched-payments card measures payments against the
   * invoices they are meant to settle, and writes through its own API route. */
  invoices: Invoice[];
  invoiceItems: InvoiceItem[];
  displayCurrency: string;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const t = useDict();
  const confirm = useConfirmation();
  const locale = useDateLocale();
  const toast = useToast();
  const now = useNow();
  const monthKey = now ? currentMonthKey(now) : null;
  const monthStart = useMemo(() => monthKey ? parseISO(`${monthKey}-01`) : null, [monthKey]);
  const [txOpen, setTxOpen] = useState(false), [accountOpen, setAccountOpen] = useState(false);
  const [search, setSearch] = useState(''), [kind, setKind] = useState('all'), [accountFilter, setAccountFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(50);
  const filterId = useId();
  const [txForm, setTxForm] = useState<TxForm>({ ...emptyTx, currency: displayCurrency });
  const [dateChosen, setDateChosen] = useState(false);
  const [acctForm, setAcctForm] = useState<AccountForm>({ ...emptyAccount, currency: displayCurrency });
  const [editingAcct, setEditingAcct] = useState<string | null>(null);
  const [editBuf, setEditBuf] = useState<{ name: string; balance: string }>({
    name: "",
    balance: "",
  });
  const [error, setError] = useState<string | null>(null);

  const totalNet = netWorth(accounts, displayCurrency);
  const months = useMemo(
    () =>
      (monthStart ? monthlyTotals(transactions, displayCurrency, 6, monthStart) : []).map((m) => ({
        ...m,
        // Re-derive the axis label in the active locale (lib emits English).
        label: format(parseISO(`${m.month}-01`), t.finances.monthFormat, {
          locale,
        }),
      })),
    [transactions, displayCurrency, t, locale, monthStart],
  );
  const categories = useMemo(() => {
    if (!monthKey) return [];
    const labelFor = (name: string) =>
      name === "Uncategorized"
        ? t.finances.categoryUncategorized
        : name === "Subscriptions"
          ? t.finances.categorySubscriptions
          : name;
    return expenseByCategory(
      transactions,
      displayCurrency,
      monthKey,
    ).map((c) => ({ ...c, name: labelFor(c.name) }));
  }, [transactions, displayCurrency, t, monthKey]);

  // CREATE transaction: needs the server-generated id, so apply state in
  // onSuccess (non-optimistic). Validation stays in the submit handler.
  const addTxMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
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
          occurred_on: txForm.occurred_on || todayKey(),
          project_id: txForm.project_id || null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as Transaction;
    },
    onSuccess: (tx) => {
      setTransactions((prev) => [tx, ...prev]);
      setTxOpen(false);
      setTxForm({ ...emptyTx, currency: txForm.currency });
      setDateChosen(false);
      void qc.invalidateQueries({ queryKey: qk.transactions });
    },
    onError: () => setError(t.professional.couldNotSave),
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
      toast.err(t.professional.couldNotSave);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.transactions }),
  });

  // CREATE account: needs the server-generated id, so apply state in onSuccess.
  const addAccountMutation = useMutation({
    mutationFn: async () => {
      const userId = await currentUserId(supabase);
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
      setAcctForm({ ...emptyAccount, currency: acctForm.currency });
      setAccountOpen(false);
      void qc.invalidateQueries({ queryKey: qk.accounts });
    },
    onError: () => toast.err(t.professional.couldNotSave),
  });

  function startEditAccount(a: Account) {
    if (accountBusy) return;
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
      return { prev };
    },
    onSuccess: (_result, { id }) => setEditingAcct(current => current === id ? null : current),
    onError: (_e, _vars, ctx) => {
      if (ctx?.prev) setAccounts(ctx.prev);
      toast.err(t.professional.couldNotSave);
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
      toast.err(t.professional.couldNotSave);
    },
    onSuccess: (_result, id) => setAccountFilter(current => current === id ? "all" : current),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.accounts }), qc.invalidateQueries({ queryKey: qk.transactions })]),
  });
  const accountBusy = addAccountMutation.isPending || saveAccountMutation.isPending || deleteAccountMutation.isPending;

  function addTx(e: React.FormEvent) {
    e.preventDefault();
    if (addTxMutation.isPending) return;
    setError(null);
    if (!txForm.amount || Number(txForm.amount) <= 0) {
      setError(t.finances.amountRequired);
      return;
    }
    addTxMutation.mutate();
  }

  const removeTx = async (id: string) => {
    if (removeTxMutation.isPending) return;
    if (await confirm({
      title: t.common.delete,
      description: t.common.deletePermanentlyConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) removeTxMutation.mutate(id);
  };

  function addAccount(e: React.FormEvent) {
    e.preventDefault();
    if (accountBusy || !acctForm.name.trim() || !Number.isFinite(Number(acctForm.balance))) return;
    addAccountMutation.mutate();
  }

  function saveAccount(id: string) {
    const balance = Number(editBuf.balance);
    if (accountBusy || !Number.isFinite(balance) || !editBuf.name.trim()) return;
    const patch = {
      name: editBuf.name.trim(),
      balance,
      updated_at: new Date().toISOString(),
    };
    saveAccountMutation.mutate({ id, patch });
  }

  const deleteAccount = async (id: string) => {
    if (accountBusy) return;
    if (await confirm({
      title: t.common.delete,
      description: t.common.deletePermanentlyConfirm,
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    })) deleteAccountMutation.mutate(id);
  };

  const thisMonth = months[months.length - 1] ?? { income: 0, expense: 0 };
  const thisMonthNet = thisMonth.income - thisMonth.expense;

  const filteredTransactions = useMemo(() => transactions.filter(tx => (kind === 'all' || tx.kind === kind) && (accountFilter === 'all' || tx.account_id === accountFilter)
    && `${tx.note ?? ''} ${tx.category ?? ''} ${tx.amount}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())).toSorted((a, b) => b.occurred_on.localeCompare(a.occurred_on) || b.id.localeCompare(a.id)), [transactions, kind, accountFilter, search]);
  const accountsContent = (<Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Wallet className="h-3 w-3" /> {t.finances.accountsTitle}
            </CardTitle>
          </CardHeader>
          <CardContent>
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
                        <div className="flex flex-1 flex-wrap items-center gap-1">
                          <Input
                            aria-label={t.finances.accountNamePlaceholder}
                            required
                            maxLength={200}
                            disabled={accountBusy}
                            value={editBuf.name}
                            onChange={(e) =>
                              setEditBuf({ ...editBuf, name: e.target.value })
                            }
                            className="h-11 flex-1 min-w-24 text-xs md:h-8"
                          />
                          <Input
                            type="number"
                            step="0.01"
                            aria-label={t.finances.balancePlaceholder}
                            disabled={accountBusy}
                            value={editBuf.balance}
                            onChange={(e) =>
                              setEditBuf({ ...editBuf, balance: e.target.value })
                            }
                            className="h-11 w-24 text-xs md:h-8"
                          />
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => saveAccount(a.id)}
                            disabled={accountBusy || !editBuf.name.trim()}
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
                            <div className="flex opacity-100 md:opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                              <Tooltip content={t.common.edit}>
                                <Button
                                  size="icon-sm"
                                  variant="ghost"
                                  onClick={() => startEditAccount(a)}
                                  disabled={accountBusy}
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
                                  disabled={accountBusy}
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


          </CardContent>
        </Card>);
  const transactionsContent = (<Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>{t.finances.recentTransactions}</CardTitle>
          </CardHeader>
          <CardContent>
            {filteredTransactions.length === 0 ? (
              <EmptyState
                title={transactions.length ? t.finances.filteredEmpty : t.finances.noTransactionsYet}
                description={transactions.length ? undefined : t.finances.addFewTransactions}
              />
            ) : (
              <ul className="-mx-2 divide-y divide-border">
                {filteredTransactions.slice(0, visibleCount).map((tx) => (
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
                        <p className="text-[11px] text-foreground-subtle tabular [overflow-wrap:anywhere]">
                          {tx.occurred_on}
                          {tx.project_id
                            ? ` · ${projects.find((project) => project.id === tx.project_id)?.name ?? t.finances.project}`
                            : ""}
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
                          disabled={removeTxMutation.isPending}
                          aria-label={t.common.delete}
                          className="opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </Tooltip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {filteredTransactions.length > visibleCount && <Button variant="outline" size="sm" onClick={() => setVisibleCount(count => count + 50)}>{t.finances.loadMore}</Button>}
          </CardContent>
        </Card>);
  const categoryContent = (<Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.finances.thisMonthByCategory}</CardTitle>
          </CardHeader>
          <CardContent>
            {!monthStart ? <Skeleton className="h-48" /> : categories.length === 0 ? (
              <EmptyState
                title={t.finances.nothingThisMonth}
                description={t.finances.categorizeHint}
                className="py-10"
              />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 items-center">
                <div className="h-48 sm:h-56">
                  <CategoryDonut
                    data={categories}
                    currency={displayCurrency}
                    innerRadius={45}
                    outerRadius={85}
                  />
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
        </Card>);
  const chartContent = (<Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.finances.last6Months}</CardTitle>
          </CardHeader>
          <CardContent>
            {!monthStart ? <Skeleton className="h-52" /> : months.every((m) => m.income === 0 && m.expense === 0) ? (
              <EmptyState
                title={t.finances.noTransactionsYet}
                description={t.finances.addFewTransactions}
                className="py-10"
              />
            ) : (
              <div className="h-52 sm:h-64">
                <MonthsBarChart
                  data={months}
                  currency={displayCurrency}
                  incomeLabel={t.finances.income}
                  expenseLabel={t.finances.expense}
                />
              </div>
            )}
          </CardContent>
        </Card>);
  return <div className="space-y-4" data-testid={`finance-${view}`}>
    <PageHeader title={view === 'overview' ? t.finances.title : t.nav.sections[view]}
      description={view === 'overview' ? t.finances.description : view === 'accounts' ? t.finances.accountsDescription : view === 'transactions' ? t.finances.transactionsDescription : t.finances.categoriesDescription}
      action={view !== 'categories' && <div className="flex gap-2">{view !== 'transactions' && <Button onClick={() => setAccountOpen(true)}><Plus />{t.finances.addAccount}</Button>}{view !== 'accounts' && <Button onClick={() => { setError(null); if (!dateChosen) setTxForm(current => ({ ...current, occurred_on: todayKey() })); setTxOpen(true); }}><Plus />{t.finances.addTransaction}</Button>}</div>} />
    {view === 'accounts' && <><p className="text-sm text-foreground-muted">{t.finances.netWorth}: <strong className="tabular text-foreground">{formatCurrency(totalNet, displayCurrency)}</strong></p><div className="grid items-start gap-4 lg:grid-cols-2">{accountsContent}<BankSync transactions={transactions} projects={projects} subscriptions={subscriptions} /></div></>}
    {view === 'transactions' && <>
      <div role="search" className="flex flex-wrap gap-2">
        <Input aria-label={t.finances.searchTransactions} type="search" placeholder={t.finances.searchTransactions} value={search} onChange={event => { setSearch(event.target.value); setVisibleCount(50); }} className="min-w-40 flex-1" />
        <SimpleSelect aria-label={t.finances.transactionKind} value={kind} onValueChange={value => { setKind(value); setVisibleCount(50); }} className="w-40" options={[{value:'all',label:t.finances.allKinds},{value:'income',label:t.finances.income},{value:'expense',label:t.finances.expense}]} />
        <label htmlFor={filterId} className="sr-only">{t.finances.account}</label><select id={filterId} className="h-11 rounded-md border border-border bg-surface px-3 text-sm focus-ring md:h-8" value={accountFilter} onChange={event => { setAccountFilter(event.target.value); setVisibleCount(50); }}><option value="all">{t.finances.allAccounts}</option>{accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</select>
        <span role="status" className="py-2 text-xs text-foreground-muted tabular">{filteredTransactions.length} / {transactions.length}</span>
      </div>
      {transactionsContent}
      <details className="border-t border-border pt-3"><summary className="min-h-11 cursor-pointer text-sm font-medium focus-ring">{t.finances.importAndMatch}</summary><div className="mt-3 grid items-start gap-4 lg:grid-cols-2"><BankSync transactions={transactions} projects={projects} subscriptions={subscriptions} /><PaymentMatches transactions={transactions} invoices={invoices} invoiceItems={invoiceItems} /></div></details>
    </>}
    {view === 'categories' && <div className="grid items-start gap-4 lg:grid-cols-3"><TransactionRules transactions={transactions} projects={projects} subscriptions={subscriptions} />{categoryContent}</div>}
    {view === 'overview' && <>
<section className="surface-band mb-4 overflow-hidden p-4 sm:p-5">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-1.5 text-foreground-muted">
              <Wallet className="h-3.5 w-3.5" />
              <SectionLabel>{t.finances.netWorth}</SectionLabel>
            </div>
            <p className="mt-1.5 text-4xl font-semibold tracking-tight tabular text-foreground sm:text-5xl">
              {formatCurrency(totalNet, displayCurrency)}
            </p>
            <p className="mt-1 text-xs text-foreground-subtle">
              {t.finances.acrossAccounts(accounts.length)}
            </p>
          </div>
          <div className="sm:text-right">
            <SectionLabel className="!text-[10px] text-foreground-subtle">
              {t.finances.thisMonth}
            </SectionLabel>
            <div className="mt-1.5 grid grid-cols-3 gap-2 sm:gap-2.5">
              <StatTile
                icon={ArrowUpRight}
                tone="success"
                label={t.finances.income}
                value={monthStart ? formatCurrency(thisMonth.income, displayCurrency) : "—"}
              />
              <StatTile
                icon={ArrowDownRight}
                tone="destructive"
                label={t.finances.expense}
                value={monthStart ? formatCurrency(thisMonth.expense, displayCurrency) : "—"}
              />
              <StatTile
                icon={Wallet}
                tone="neutral"
                label={t.finances.net}
                value={monthStart ? formatCurrency(thisMonthNet, displayCurrency) : "—"}
              />
            </div>
          </div>
        </div>
      </section>

      {/* Cost overview — aggregate project + subscription spend as pies. */}
      <CostOverview
        projects={projects}
        projectCosts={projectCosts}
        crons={crons}
        subscriptions={subscriptions}
        displayCurrency={displayCurrency}
      />
      <div className="grid items-start gap-4 lg:grid-cols-3">{accountsContent}{chartContent}{categoryContent}{transactionsContent}</div>
    </>}
    <Dialog open={accountOpen} onOpenChange={setAccountOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>{t.finances.addAccount}</DialogTitle></DialogHeader>
<form
              onSubmit={addAccount}
              className="space-y-3"
            >
              <fieldset disabled={accountBusy} aria-label={t.finances.addAccount} className="space-y-3">
              <Input
                required
                maxLength={200}
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
                <SimpleSelect
                  value={acctForm.currency}
                  aria-label={t.finances.ccy}
                  onValueChange={(v) =>
                    setAcctForm({ ...acctForm, currency: v })
                  }
                  options={SUPPORTED_CURRENCIES.map((c) => ({
                    value: c,
                    label: c,
                  }))}
                />
              </div>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={accountBusy || !acctForm.name.trim()}
              >
                <Plus className="h-3.5 w-3.5" /> {t.finances.addAccount}
              </Button>
              </fieldset>
            </form>
    </DialogContent></Dialog>
    <Dialog open={txOpen} onOpenChange={setTxOpen}><DialogContent aria-describedby={undefined}><DialogHeader><DialogTitle>{t.finances.addTransaction}</DialogTitle></DialogHeader>
<form onSubmit={addTx} className="space-y-3">
              <fieldset disabled={addTxMutation.isPending} aria-label={t.finances.addTransaction} className="space-y-3">
              <div className="grid grid-cols-2 gap-2 p-0.5 rounded-md bg-surface-muted">
                <button
                  type="button"
                  aria-pressed={txForm.kind === "expense"}
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
                  aria-pressed={txForm.kind === "income"}
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
                  <SimpleSelect
                    id="tx-currency"
                    value={txForm.currency}
                    onValueChange={(v) =>
                      setTxForm({ ...txForm, currency: v })
                    }
                    options={SUPPORTED_CURRENCIES.map((c) => ({
                      value: c,
                      label: c,
                    }))}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-category">{t.finances.category}</Label>
                <CategorySelect
                  id="tx-category"
                  ariaLabel={t.finances.category}
                  value={txForm.category}
                  onChange={(v) => setTxForm({ ...txForm, category: v })}
                  used={transactions.map((tx) => tx.category)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tx-date">{t.finances.date}</Label>
                <Input
                  id="tx-date"
                  type="date"
                  value={txForm.occurred_on || (now ? todayKey(now) : "")}
                  required
                  onChange={(e) => {
                    setDateChosen(true);
                    setTxForm({ ...txForm, occurred_on: e.target.value });
                  }}
                />
              </div>
              {accounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-account">{t.finances.account}</Label>
                  <SimpleSelect
                    id="tx-account"
                    value={txForm.account_id}
                    onValueChange={(v) =>
                      setTxForm({ ...txForm, account_id: v })
                    }
                    options={[
                      { value: "", label: t.finances.noneOption },
                      ...accounts.map((a) => ({ value: a.id, label: a.name })),
                    ]}
                  />
                </div>
              )}
              {projects.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-project">{t.finances.project}</Label>
                  <SimpleSelect
                    id="tx-project"
                    value={txForm.project_id}
                    onValueChange={(project_id) => setTxForm({ ...txForm, project_id })}
                    options={[
                      { value: "", label: t.finances.noneOption },
                      ...projects.map((project) => ({ value: project.id, label: project.name })),
                    ]}
                  />
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
              {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={addTxMutation.isPending}>
                <Plus className="h-3.5 w-3.5" /> {t.common.add}
              </Button>
              </fieldset>
            </form>
    </DialogContent></Dialog>
  </div>;
}
