"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  Building2,
  KeyRound,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  Unlink,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { currentUserId } from "@/lib/supabase/user";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { fetchBankConnections, fetchTransactionRules } from "@/lib/queries/fetchers";
import { parseBankCsv, type ParseResult } from "@/lib/bank-csv";
import { applyRulesToRow, usableRules } from "@/lib/transaction-rules";
import type { BankConnection, Project, Subscription, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

type Institution = { id: string; name: string; bic: string | null; logo: string | null };

type ProviderState = {
  id: string;
  label: string;
  configured: boolean;
  connected: boolean;
  /** False for a token provider such as Fio, which has no bank list and no
   *  redirect — it is configured in this dialog instead. */
  supportsInstitutionPicker: boolean;
};

/** Which providers this server can actually use. Comes from the same
 *  authenticated status endpoint Settings reads, which reports booleans only —
 *  no token or secret value is ever part of this shape. */
async function fetchBankProviders(): Promise<ProviderState[]> {
  const res = await fetch("/api/integrations/status", { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { bank?: { providers?: ProviderState[] } };
  return json.bank?.providers ?? [];
}

export function BankSync({
  transactions,
  projects,
  subscriptions,
}: {
  transactions: Transaction[];
  /** Used only to keep a rule action from writing a relationship the owner no
   * longer has, which the transactions RLS policies would reject outright. */
  projects: Project[];
  subscriptions: Subscription[];
}) {
  const t = useDict();
  const qc = useQueryClient();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);

  const connectionsQuery = useQuery({
    queryKey: qk.bankConnections,
    queryFn: fetchBankConnections,
  });
  const connections = connectionsQuery.data ?? [];

  // Pull the latest balances + transactions. With a connection id it syncs that
  // one bank, without it every bank the owner has. `variables` is what keeps the
  // spinner on the row that was actually pressed.
  const syncMutation = useMutation({
    mutationFn: async (connectionId?: string) => {
      const res = await fetch("/api/bank/sync", {
        method: "POST",
        ...(connectionId
          ? {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ connectionId }),
            }
          : {}),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { inserted: number };
    },
    onSuccess: ({ inserted }) => {
      toast.ok(inserted > 0 ? t.finances.bank.syncDone(inserted) : t.finances.bank.syncNothing);
      void qc.invalidateQueries({ queryKey: qk.transactions });
      void qc.invalidateQueries({ queryKey: qk.accounts });
      void qc.invalidateQueries({ queryKey: qk.bankConnections });
    },
    onError: () => toast.err(t.finances.bank.syncErr),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/bank/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(String(res.status));
    },
    onSettled: () => qc.invalidateQueries({ queryKey: qk.bankConnections }),
  });

  // Handle the return trip from the bank consent screen (?bank=linked|error).
  const handledReturn = useRef(false);
  useEffect(() => {
    if (handledReturn.current) return;
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("bank");
    if (!outcome) return;
    handledReturn.current = true;
    // Strip the param so a refresh doesn't re-trigger.
    params.delete("bank");
    const qs = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (qs ? `?${qs}` : ""));
    if (outcome === "linked") {
      toast.ok(t.finances.bank.linkedToast);
      void qc.invalidateQueries({ queryKey: qk.bankConnections });
      syncMutation.mutate(undefined);
    } else if (outcome === "error") {
      toast.err(t.finances.bank.linkErrToast);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const syncingAll = syncMutation.isPending && syncMutation.variables === undefined;

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="inline-flex items-center gap-1.5">
            <Landmark className="h-3 w-3" /> {t.finances.bank.title}
          </CardTitle>
          <p className="mt-1 text-xs normal-case tracking-normal text-foreground-subtle">
            {t.finances.bank.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {connections.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncMutation.mutate(undefined)}
              disabled={syncMutation.isPending}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", syncingAll && "animate-spin")}
              />
              {syncingAll ? t.finances.bank.syncing : t.finances.bank.syncNow}
            </Button>
          )}
          <Button size="sm" onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t.finances.bank.connect}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connections.length > 0 && (
          <ul className="-mx-2 divide-y divide-border">
            {connections.map((c) => (
              <ConnectionRow
                key={c.id}
                conn={c}
                onSync={() => syncMutation.mutate(c.id)}
                syncing={
                  syncMutation.isPending && syncMutation.variables === c.id
                }
                onDisconnect={() => {
                  if (window.confirm(t.finances.bank.disconnectConfirm))
                    disconnectMutation.mutate(c.id);
                }}
                disconnecting={disconnectMutation.isPending}
              />
            ))}
          </ul>
        )}

        <CsvImport
          transactions={transactions}
          projects={projects}
          subscriptions={subscriptions}
        />
      </CardContent>

      <BankPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </Card>
  );
}

/* ------------------------------ connection row ---------------------------- */

function ConnectionRow({
  conn,
  onSync,
  syncing,
  onDisconnect,
  disconnecting,
}: {
  conn: BankConnection;
  onSync: () => void;
  syncing: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
}) {
  const t = useDict();
  const statusLabel =
    conn.status === "linked"
      ? t.finances.bank.statusLinked
      : conn.status === "expired"
        ? t.finances.bank.statusExpired
        : conn.status === "error"
          ? t.finances.bank.statusError
          : t.finances.bank.statusCreated;
  const tone =
    conn.status === "linked"
      ? "bg-success/10 text-success"
      : conn.status === "error" || conn.status === "expired"
        ? "bg-destructive/10 text-destructive"
        : "bg-warning/10 text-warning";
  // Only ever rendered from a value the provider actually stated; a provider
  // with no expiry (a Fio token) simply shows nothing here.
  const expiresOn = conn.consent_expires_at?.slice(0, 10) ?? null;
  return (
    <li className="group flex items-center gap-3 px-2 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground-muted">
        <Building2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {conn.institution_name ?? conn.institution_id ?? conn.provider}
        </p>
        <p className="text-[11px] text-foreground-subtle tabular">
          {conn.last_synced_at
            ? t.finances.bank.lastSynced(conn.last_synced_at.slice(0, 10))
            : t.finances.bank.neverSynced}
          {expiresOn ? ` · ${t.finances.bank.consentExpires(expiresOn)}` : ""}
        </p>
        {conn.status === "expired" ? (
          <p className="text-[11px] text-destructive">
            {t.finances.bank.consentExpired}
          </p>
        ) : conn.last_error ? (
          <p className="truncate text-[11px] text-destructive">{conn.last_error}</p>
        ) : null}
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-[3px] text-[10px] font-medium", tone)}>
        {statusLabel}
      </span>
      <Tooltip content={t.finances.bank.syncThis}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSync}
          disabled={syncing}
          aria-label={t.finances.bank.syncThis}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
        </Button>
      </Tooltip>
      <Tooltip content={t.finances.bank.disconnect}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDisconnect}
          disabled={disconnecting}
          aria-label={t.finances.bank.disconnect}
          className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        >
          <Unlink className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </Tooltip>
    </li>
  );
}

/* -------------------------------- CSV import ------------------------------ */

function CsvImport({
  transactions,
  projects,
  subscriptions,
}: {
  transactions: Transaction[];
  projects: Project[];
  subscriptions: Subscription[];
}) {
  const t = useDict();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  // The same rule engine the sync and the retroactive apply use, so an imported
  // row lands in the category the editor's preview promised.
  const rulesQuery = useQuery({
    queryKey: qk.transactionRules,
    queryFn: fetchTransactionRules,
    retry: false,
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    try {
      const text = await file.text();
      setParsed(parseBankCsv(text));
    } catch {
      toast.err(t.finances.bank.csvParseErr);
      setParsed(null);
    }
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsed || parsed.rows.length === 0) return { added: 0, dup: 0 };
      const userId = await currentUserId(supabase);
      if (!userId) throw new Error("no-user");

      // Skip anything we already hold (dedupe on external_id).
      const existing = new Set(
        transactions.map((tx) => tx.external_id).filter(Boolean) as string[],
      );
      const fresh = parsed.rows.filter((r) => !existing.has(r.external_id));
      if (fresh.length === 0) {
        return { added: 0, dup: parsed.rows.length };
      }
      const rules = usableRules(rulesQuery.data?.rules ?? []);
      const owned = {
        projectIds: new Set(projects.map((p) => p.id)),
        subscriptionIds: new Set(subscriptions.map((s) => s.id)),
      };
      const payload = fresh.map((r) =>
        applyRulesToRow(
          {
            user_id: userId,
            account_id: null,
            kind: r.kind,
            amount: r.amount,
            currency: r.currency,
            category: null as string | null,
            note: r.note,
            occurred_on: r.occurred_on,
            external_id: r.external_id,
            // Carried through so the payment matcher can pair an imported
            // statement row with an open invoice.
            variable_symbol: r.variable_symbol,
          },
          rules,
          owned,
        ),
      );
      const { data, error } = await supabase
        .from("transactions")
        .upsert(payload, {
          onConflict: "user_id,external_id",
          ignoreDuplicates: true,
        })
        .select();
      if (error) throw error;
      const added = data?.length ?? 0;
      return { added, dup: parsed.rows.length - added };
    },
    onSuccess: ({ added, dup }) => {
      if (added === 0) {
        toast.ok(t.finances.bank.nothingToImport);
      } else {
        toast.ok(t.finances.bank.importDone(added, dup));
        void qc.invalidateQueries({ queryKey: qk.transactions });
      }
      setParsed(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: () => toast.err(t.finances.bank.importErr),
  });

  return (
    <div className="rounded-lg border border-dashed border-border-strong bg-surface-muted/30 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <Upload className="h-3.5 w-3.5 text-foreground-muted" />
        <span className="text-xs font-medium text-foreground">
          {t.finances.bank.importTitle}
        </span>
      </div>
      <p className="mt-1 text-[11px] text-foreground-subtle">{t.finances.bank.csvHint}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={onFile}
          className="hidden"
          id="bank-csv-input"
        />
        <Button size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
          {t.finances.bank.chooseFile}
        </Button>
        {fileName && (
          <span className="truncate text-xs text-foreground-subtle">{fileName}</span>
        )}
      </div>

      {parsed && (
        <div className="mt-3 space-y-2 rounded-md border border-border bg-surface p-3">
          <p className="text-xs font-medium text-foreground">
            {t.finances.bank.csvReady(
              parsed.rows.length,
              parsed.errors.length,
            )}
          </p>
          {parsed.columns.date && parsed.columns.amount && (
            <p className="text-[11px] text-foreground-subtle">
              {t.finances.bank.csvColumns(parsed.columns.date, parsed.columns.amount)}
            </p>
          )}
          {parsed.errors.length === 0 || parsed.rows.length > 0 ? (
            <Button
              size="sm"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending || parsed.rows.length === 0}
            >
              {importMutation.isPending ? t.finances.bank.importing : t.finances.bank.import}
            </Button>
          ) : (
            <p className="text-[11px] text-destructive">{parsed.errors[0]}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ bank picker ------------------------------- */

function BankPickerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const t = useDict();
  const qc = useQueryClient();
  const toast = useToast();
  const [step, setStep] = useState<"provider" | "institutions" | "token">("provider");
  const [providerId, setProviderId] = useState("gocardless");
  const [query, setQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const providersQuery = useQuery({
    queryKey: ["bank", "providers"],
    enabled: open,
    queryFn: fetchBankProviders,
  });

  const institutionsQuery = useQuery({
    queryKey: ["bank", "institutions", providerId, "cz"],
    enabled: open && step === "institutions",
    queryFn: async () => {
      const res = await fetch(
        `/api/bank/institutions?country=cz&provider=${encodeURIComponent(providerId)}`,
      );
      if (res.status === 503) {
        setNotConfigured(true);
        return [] as Institution[];
      }
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { institutions: Institution[] };
      return json.institutions;
    },
  });

  const filtered = useMemo(() => {
    const all = institutionsQuery.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((b) => b.name.toLowerCase().includes(q));
  }, [institutionsQuery.data, query]);

  async function connect(inst: Institution) {
    setConnectingId(inst.id);
    try {
      const res = await fetch("/api/bank/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: providerId,
          institutionId: inst.id,
          institutionName: inst.name,
        }),
      });
      if (res.status === 503) {
        setNotConfigured(true);
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const { link } = (await res.json()) as { link: string };
      window.location.assign(link);
    } catch {
      toast.err(t.finances.bank.connectErr);
      setConnectingId(null);
    }
  }

  function choose(provider: ProviderState) {
    setProviderId(provider.id);
    if (!provider.supportsInstitutionPicker) {
      setStep("token");
      return;
    }
    setNotConfigured(!provider.configured);
    setStep("institutions");
  }

  const chosen =
    (providersQuery.data ?? []).find((provider) => provider.id === providerId) ??
    null;
  const heading =
    step === "provider"
      ? t.finances.bank.providerStep
      : step === "token"
        ? (chosen?.label ?? t.finances.bank.fioTitle)
        : t.finances.bank.pickBank;
  const description =
    step === "provider"
      ? t.finances.bank.providerStepDesc
      : step === "token"
        ? t.finances.bank.fioHint
        : t.finances.bank.pickBankDesc;

  // Closing is what resets the flow, so reopening always starts at the provider
  // step and a previous choice never decides the next one.
  function handleOpenChange(next: boolean) {
    if (!next) {
      setStep("provider");
      setQuery("");
      setNotConfigured(false);
      setConnectingId(null);
      setProviderId("gocardless");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step !== "provider" && (
          <div className="mt-3">
            <Button size="sm" variant="ghost" onClick={() => setStep("provider")}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {t.finances.bank.providerBack}
            </Button>
          </div>
        )}

        {step === "provider" && (
          <ul className="mt-4 space-y-1">
            {(providersQuery.data ?? []).map((provider) => {
              // A token provider is always reachable — this dialog is where it
              // gets configured. Everything else needs server-side credentials.
              const usable = provider.configured || !provider.supportsInstitutionPicker;
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    onClick={() => choose(provider)}
                    disabled={!usable}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-muted">
                      {!provider.supportsInstitutionPicker ? (
                        <KeyRound className="h-3.5 w-3.5 text-foreground-muted" />
                      ) : (
                        <Building2 className="h-3.5 w-3.5 text-foreground-muted" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm">{provider.label}</span>
                      {!usable && (
                        <span className="block text-[11px] text-foreground-subtle">
                          {t.finances.bank.providerNotConfigured}
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
            {providersQuery.isError && (
              <li className="py-8 text-center text-xs text-destructive">
                {t.finances.bank.loadBanksErr}
              </li>
            )}
          </ul>
        )}

        {step === "token" && (
          <FioTokenForm
            onSaved={() => {
              void qc.invalidateQueries({ queryKey: qk.bankConnections });
              void qc.invalidateQueries({ queryKey: qk.transactions });
              void qc.invalidateQueries({ queryKey: qk.accounts });
              void providersQuery.refetch();
              handleOpenChange(false);
            }}
          />
        )}

        {step === "institutions" &&
          (notConfigured ? (
            <p className="mt-4 rounded-md border border-border bg-surface-muted/40 p-3 text-xs text-foreground-muted">
              {t.finances.bank.notConfigured}
            </p>
          ) : (
            <>
              <div className="relative mt-4">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-foreground-subtle" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.finances.bank.searchBank}
                  className="pl-8"
                />
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                {institutionsQuery.isPending ? (
                  <p className="py-8 text-center text-xs text-foreground-subtle">…</p>
                ) : institutionsQuery.isError ? (
                  <p className="py-8 text-center text-xs text-destructive">
                    {t.finances.bank.loadBanksErr}
                  </p>
                ) : filtered.length === 0 ? (
                  <p className="py-8 text-center text-xs text-foreground-subtle">
                    {t.finances.bank.noBanks}
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {filtered.map((inst) => (
                      <li key={inst.id}>
                        <button
                          type="button"
                          onClick={() => connect(inst)}
                          disabled={connectingId !== null}
                          className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring disabled:opacity-60"
                        >
                          {inst.logo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={inst.logo}
                              alt=""
                              className="h-6 w-6 shrink-0 rounded object-contain"
                            />
                          ) : (
                            <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface-muted">
                              <Building2 className="h-3.5 w-3.5 text-foreground-muted" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-sm">{inst.name}</span>
                          {connectingId === inst.id && (
                            <RefreshCw className="h-3.5 w-3.5 animate-spin text-foreground-subtle" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          ))}
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------ Fio token form ---------------------------- */

/**
 * The Fio API token. It is posted to the server and never read back: the GET
 * beside it reports presence as a boolean, which is all this form needs to say
 * a token is already stored.
 */
function FioTokenForm({ onSaved }: { onSaved: () => void }) {
  const t = useDict();
  const toast = useToast();
  const [token, setToken] = useState("");

  const storedQuery = useQuery({
    queryKey: ["bank", "credentials"],
    queryFn: async () => {
      const res = await fetch("/api/bank/credentials", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const json = (await res.json()) as { stored?: Record<string, boolean> };
      return Boolean(json.stored?.fio);
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (value: string) => {
      const res = await fetch("/api/bank/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "fio", token: value }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const { connectionId } = (await res.json()) as {
        connectionId: string | null;
      };
      // Saving proves nothing on its own; the first sync is what shows whether
      // Fio accepts the token, so it runs immediately.
      if (connectionId) {
        await fetch("/api/bank/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ connectionId }),
        });
      }
    },
    onSuccess: () => {
      toast.ok(t.finances.bank.fioSaved);
      setToken("");
      onSaved();
    },
    onError: () => toast.err(t.finances.bank.fioErr),
  });

  return (
    <form
      className="mt-4 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const value = token.trim();
        if (value.length < 16) {
          toast.err(t.finances.bank.fioErr);
          return;
        }
        saveMutation.mutate(value);
      }}
    >
      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="fio-token">
          {t.finances.bank.fioTitle}
        </label>
        <Input
          id="fio-token"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder={t.finances.bank.fioPlaceholder}
        />
        <p className="text-[11px] text-foreground-subtle">
          {t.finances.bank.serverSideOnly}
        </p>
        {storedQuery.data === true && (
          <p className="text-[11px] text-foreground-subtle">
            {t.finances.bank.fioStored}
          </p>
        )}
      </div>
      <Button
        type="submit"
        size="sm"
        disabled={saveMutation.isPending || token.trim().length === 0}
      >
        {saveMutation.isPending
          ? t.finances.bank.fioSaving
          : t.finances.bank.fioSave}
      </Button>
    </form>
  );
}
