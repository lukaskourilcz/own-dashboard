"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import { bankConsentUrl, bankInstitutionsResponse, type BankInstitution as Institution, type BankProviderState as ProviderState } from "@/lib/bank/flow";
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
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { importTransactionBatch } from "@/lib/transaction-import";
import { useDict } from "@/lib/i18n";
import { fetchIntegrationStatus } from "@/lib/integration-status";
import { qk } from "@/lib/queries/keys";
import { fetchBankConnections, fetchTransactionRules } from "@/lib/queries/fetchers";
import { prepareBankCsv, csvRowsToImport, CsvLegacyConflict, MAX_CSV_BYTES, type ParseResult } from "@/lib/bank-csv";
import { assertRuleEvaluationBounds, createRuleEvaluator, RuleEvaluationLimitError, usableRules } from "@/lib/transaction-rules";
import type { BankConnection, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

class BankNotConfigured extends Error {}

export function BankSync({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const t = useDict();
  const qc = useQueryClient();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);
  const confirm = useConfirmation();
  const [actionError, setActionError] = useState<string | null>(null);

  const connectionsQuery = useQuery({
    queryKey: qk.bankConnections,
    queryFn: fetchBankConnections,
    retry: false,
  });
  const connections = connectionsQuery.data ?? [];
  const providersQuery = useQuery({
    queryKey: qk.integrationStatus,
    queryFn: fetchIntegrationStatus,
    select: data => data.bank.providers,
    staleTime: 60_000,
    retry: false,
  });
  const canConnect = (providersQuery.data ?? []).some(provider => provider.configured || provider.connected);

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
      const result = await res.json();
      if (!result || !Number.isSafeInteger(result.inserted) || result.inserted < 0) throw new Error("Invalid sync receipt");
      return result as { inserted: number };
    },
    onMutate: () => setActionError(null),
    onSuccess: ({ inserted }) => toast.ok(inserted > 0 ? t.finances.bank.syncDone(inserted) : t.finances.bank.syncNothing),
    onError: () => setActionError(t.finances.bank.syncErr),
    onSettled: () => Promise.all([
      qc.invalidateQueries({ queryKey: qk.transactions }), qc.invalidateQueries({ queryKey: qk.accounts }),
      qc.invalidateQueries({ queryKey: qk.bankConnections }), qc.invalidateQueries({ queryKey: qk.integrationStatus }),
    ]),
  });

  const disconnectMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/bank/disconnect", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const result = await res.json();
      if (result?.ok !== true || typeof result.upstreamRevoked !== "boolean") throw new Error("Invalid disconnect receipt");
      return result as { upstreamRevoked: boolean };
    },
    onMutate: () => setActionError(null),
    onSuccess: result => { if (!result.upstreamRevoked) setActionError(t.finances.bank.revokeUnconfirmed); },
    onError: () => setActionError(t.finances.bank.disconnectErr),
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.bankConnections }), qc.invalidateQueries({ queryKey: qk.integrationStatus })]),
  });
  const busy = syncMutation.isPending || disconnectMutation.isPending;
  async function disconnect(id: string) {
    if (busy) return;
    const accepted = await confirm({ title: t.finances.bank.disconnect, description: t.finances.bank.disconnectConfirm,
      confirmLabel: t.finances.bank.disconnect, cancelLabel: t.common.cancel, destructive: true });
    if (accepted && !busy) disconnectMutation.mutate(id);
  }

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
    <Card className="min-w-0" data-testid="bank-sync">
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 flex-1 basis-40">
          <CardTitle className="inline-flex items-center gap-1.5">
            <Landmark className="h-3 w-3" /> {t.finances.bank.title}
          </CardTitle>
          <p className="mt-1 text-xs normal-case tracking-normal text-foreground-subtle">
            {t.finances.bank.subtitle}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          {connections.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => syncMutation.mutate(undefined)}
              disabled={busy || !connectionsQuery.isSuccess}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", syncingAll && "animate-spin")}
              />
              {syncingAll ? t.finances.bank.syncing : t.finances.bank.syncNow}
            </Button>
          )}
          {canConnect && <Button size="sm" disabled={busy || !providersQuery.isSuccess} onClick={() => setPickerOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t.finances.bank.connect}
          </Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {actionError && <p role="alert" className="text-xs text-destructive">{actionError}</p>}
        {connectionsQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <p>{t.finances.bank.connectionsLoadErr}</p><Button size="sm" variant="outline" disabled={connectionsQuery.isFetching || busy} onClick={() => void connectionsQuery.refetch()}>{t.common.retry}</Button>
        </div>}
        {providersQuery.isError && <div role="alert" className="flex flex-wrap items-center gap-2 text-xs text-destructive">
          <p>{t.finances.bank.providersLoadErr}</p><Button size="sm" variant="outline" disabled={providersQuery.isFetching || busy} onClick={() => void providersQuery.refetch()}>{t.common.retry}</Button>
        </div>}
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
                onDisconnect={() => void disconnect(c.id)}
                disabled={busy || !connectionsQuery.isSuccess}
                disconnecting={disconnectMutation.isPending && disconnectMutation.variables === c.id}
              />
            ))}
          </ul>
        )}

        <CsvImport
          transactions={transactions}
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
  disabled,
  disconnecting,
}: {
  conn: BankConnection;
  onSync: () => void;
  syncing: boolean;
  onDisconnect: () => void;
  disabled: boolean;
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
  // Render a reported expiry only. Null does not promise unlimited validity;
  // Fio statements do not provide the token's expiry date.
  const expiresOn = conn.consent_expires_at?.slice(0, 10) ?? null;
  const bankName = conn.institution_name ?? conn.institution_id ?? conn.provider;
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 px-2 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground-muted">
        <Building2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium" title={bankName}>{bankName}</p>
        <span className={cn("inline-block rounded px-1.5 text-[10px] font-medium", tone)}>{statusLabel}</span>
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
          <p className="text-[11px] text-destructive">{conn.last_error === "bank-balance-unavailable" ? t.finances.bank.balanceUnavailable : t.finances.bank.lastSyncFailed}</p>
        ) : null}
      </div>
      <Tooltip content={t.finances.bank.syncThis}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onSync}
          disabled={disabled}
          aria-label={`${t.finances.bank.syncThis}: ${bankName}`}
        >
          <RefreshCw className={cn("h-3.5 w-3.5", syncing && "animate-spin")} />
        </Button>
      </Tooltip>
      <Tooltip content={t.finances.bank.disconnect}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDisconnect}
          disabled={disabled}
          aria-label={`${t.finances.bank.disconnect}: ${bankName}`}
          aria-busy={disconnecting}
        >
          {disconnecting ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5 text-destructive" />}
        </Button>
      </Tooltip>
    </li>
  );
}

/* -------------------------------- CSV import ------------------------------ */

function CsvImport({
  transactions,
}: {
  transactions: Transaction[];
}) {
  const t = useDict();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const readingRef = useRef(false);
  const [importError, setImportError] = useState<string | null>(null);
  // The same rule engine the sync and the retroactive apply use, so an imported
  // row lands in the category the editor's preview promised.
  const rulesQuery = useQuery({
    queryKey: qk.transactionRules,
    queryFn: fetchTransactionRules,
    retry: false,
  });

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || readingRef.current || importMutation.isPending) return;
    readingRef.current = true; setReading(true); setImportError(null); setParsed(null); setFileName(file.name);
    try {
      if (file.size > MAX_CSV_BYTES) { setImportError(t.finances.bank.csvIssue.limit); return; }
      setParsed(await prepareBankCsv(await file.text()));
    } catch { setImportError(t.finances.bank.csvParseErr); }
    finally {
      readingRef.current = false; setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!parsed || parsed.rows.length === 0) return { added: 0, dup: 0 };
      if (!rulesQuery.isSuccess || rulesQuery.data.dropped > 0) throw new Error("rules-unavailable");
      const fresh = csvRowsToImport(parsed.rows, transactions);
      if (fresh.length === 0) return { added: 0, dup: parsed.rows.length };
      const rules = usableRules(rulesQuery.data?.rules ?? []);
      const owned = {
        projectIds: new Set(rulesQuery.data.projectIds),
        subscriptionIds: new Set(rulesQuery.data.subscriptionIds),
      };
      assertRuleEvaluationBounds(fresh, rules);
      const evaluator = createRuleEvaluator(rules, owned);
      const payload = fresh.map((r) =>
        evaluator.applyToRow(
          {
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
        ),
      );
      let added = 0;
      // Batches fit below the REST return limit. A failed later batch retains
      // this file; strong unique keys make a retry safe for confirmed rows.
      for (let offset = 0; offset < payload.length; offset += 250) {
        const batch = payload.slice(offset, offset + 250);
        added += await importTransactionBatch(supabase, batch);
      }
      return { added, dup: parsed.rows.length - added };
    },
    onSuccess: ({ added, dup }) => {
      if (added === 0) {
        toast.ok(t.finances.bank.nothingToImport);
      } else {
        toast.ok(t.finances.bank.importDone(added, dup));
      }
      setParsed(null);
      setFileName(null);
      if (inputRef.current) inputRef.current.value = "";
    },
    onError: error => setImportError(error instanceof RuleEvaluationLimitError ? t.finances.bank.csvRuleLimit : error instanceof CsvLegacyConflict ? t.finances.bank.csvRowIssue(error.row, t.finances.bank.csvLegacyConflict) : t.finances.bank.importErr),
    onSettled: () => { void qc.invalidateQueries({ queryKey: qk.transactions }); },
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
          aria-label={t.finances.bank.chooseFile}
          disabled={reading || importMutation.isPending}
          onChange={onFile}
          className="hidden"
          id="bank-csv-input"
        />
        <Button size="sm" variant="outline" disabled={reading || importMutation.isPending} onClick={() => inputRef.current?.click()}>
          {reading ? t.finances.bank.csvReading : t.finances.bank.chooseFile}
        </Button>
        {fileName && (
          <span className="truncate text-xs text-foreground-subtle">{fileName}</span>
        )}
      </div>

      {importError && <p role="alert" className="mt-2 text-xs text-risk">{importError}</p>}
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
          {parsed.issues.length > 0 && <ul className="space-y-1 text-xs text-risk">{parsed.issues.slice(0, 3).map((issue, index) => <li key={index}>{issue.row ? t.finances.bank.csvRowIssue(issue.row, t.finances.bank.csvIssue[issue.code]) : t.finances.bank.csvIssue[issue.code]}</li>)}</ul>}
          {(!rulesQuery.isSuccess || rulesQuery.data.dropped > 0) && <div role="status" className="space-y-1 text-xs text-risk">
            <p>{rulesQuery.data?.dropped ? t.finances.rules.dropped(rulesQuery.data.dropped) : rulesQuery.isPending ? t.finances.bank.csvRulesLoading : t.finances.rules.loadErr}</p>
            <Button size="sm" variant="outline" disabled={rulesQuery.isFetching} onClick={() => void rulesQuery.refetch()}>{t.common.retry}</Button>
          </div>}
          {parsed.rows.length > 0 && (
            <Button
              size="sm"
              onClick={() => { setImportError(null); importMutation.mutate(); }}
              disabled={importMutation.isPending || reading || !rulesQuery.isSuccess || rulesQuery.data.dropped > 0}
            >
              {importMutation.isPending ? t.finances.bank.importing : t.finances.bank.import}
            </Button>
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
  const [step, setStep] = useState<"provider" | "institutions" | "token">("provider");
  const [providerId, setProviderId] = useState("gocardless");
  const [query, setQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connectUnavailable, setConnectUnavailable] = useState(false);
  const [tokenBusy, setTokenBusy] = useState(false);
  const connectingRef = useRef(false);
  const busy = connectingId !== null || tokenBusy;

  const providersQuery = useQuery({
    queryKey: qk.integrationStatus,
    enabled: open,
    queryFn: fetchIntegrationStatus,
    select: data => data.bank.providers,
    staleTime: 60_000,
    retry: false,
  });

  const institutionsQuery = useQuery({
    queryKey: ["bank", "institutions", providerId, "cz"],
    enabled: open && step === "institutions",
    retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/bank/institutions?country=cz&provider=${encodeURIComponent(providerId)}`, {
        cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
      });
      if (res.status === 503) throw new BankNotConfigured();
      if (!res.ok) throw new Error(String(res.status));
      const institutions = bankInstitutionsResponse.parse(await res.json()).institutions;
      if (new Set(institutions.map(bank => bank.id)).size !== institutions.length) throw new Error("Invalid institution list");
      return institutions;
    },
  });
  const notConfigured = connectUnavailable || institutionsQuery.error instanceof BankNotConfigured;

  const filtered = useMemo(() => {
    const all = institutionsQuery.data ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter((b) => b.name.toLowerCase().includes(q));
  }, [institutionsQuery.data, query]);

  async function connect(inst: Institution) {
    if (connectingRef.current || tokenBusy) return;
    connectingRef.current = true; setConnectingId(inst.id); setConnectError(null);
    let navigating = false;
    try {
      const res = await fetch("/api/bank/connect", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, institutionId: inst.id, institutionName: inst.name }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 503) { setConnectUnavailable(true); return; }
      if (!res.ok) throw new Error(String(res.status));
      const json: unknown = await res.json();
      const { link } = z.object({ link: z.string() }).parse(json);
      window.location.assign(bankConsentUrl(providerId, link));
      navigating = true;
    } catch { setConnectError(t.finances.bank.connectErr); }
    finally { if (!navigating) { connectingRef.current = false; setConnectingId(null); } }
  }

  function choose(provider: ProviderState) {
    if (busy) return;
    setProviderId(provider.id); setQuery(""); setConnectError(null); setConnectUnavailable(false);
    setStep(provider.supportsInstitutionPicker ? "institutions" : "token");
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
    if (!next && busy) return;
    if (!next) {
      setStep("provider");
      setQuery("");
      setConnectUnavailable(false);
      setConnectError(null);
      setConnectingId(null);
      setProviderId("gocardless");
    }
    onOpenChange(next);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-w-md flex-col" aria-busy={busy}>
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {step !== "provider" && (
          <div className="mt-3">
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setStep("provider"); setConnectError(null); }}>
              <ArrowLeft className="h-3.5 w-3.5" />
              {t.finances.bank.providerBack}
            </Button>
          </div>
        )}

        {step === "provider" && (
          <ul className="mt-4 space-y-1">
            {(providersQuery.data ?? []).filter(provider => provider.configured || provider.connected).map((provider) => {
              // A token provider is always reachable — this dialog is where it
              // gets configured. Everything else needs server-side credentials.
              const usable = provider.configured || !provider.supportsInstitutionPicker;
              return (
                <li key={provider.id}>
                  <button
                    type="button"
                    onClick={() => choose(provider)}
                    disabled={!usable || busy}
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
              <li role="alert" className="space-y-2 py-4 text-center text-xs text-destructive">
                <p>{t.finances.bank.providersLoadErr}</p>
                <Button size="sm" variant="outline" disabled={providersQuery.isFetching} onClick={() => void providersQuery.refetch()}>{t.common.retry}</Button>
              </li>
            )}
          </ul>
        )}

        {step === "token" && (
          <FioTokenForm
            onBusyChange={setTokenBusy}
            onSaved={(synced) => {
              void qc.invalidateQueries({ queryKey: qk.bankConnections });
              void qc.invalidateQueries({ queryKey: qk.transactions });
              void qc.invalidateQueries({ queryKey: qk.accounts });
              void providersQuery.refetch();
              if (synced) { onOpenChange(false); setStep("provider"); }
            }}
          />
        )}

        {connectError && <p role="alert" className="mt-3 text-xs text-destructive">{connectError}</p>}
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
                  aria-label={t.finances.bank.searchBank}
                  disabled={busy}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t.finances.bank.searchBank}
                  className="pl-8"
                />
              </div>

              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                {institutionsQuery.isPending ? (
                  <p className="py-8 text-center text-xs text-foreground-subtle">…</p>
                ) : institutionsQuery.isError ? (
                  <div role="alert" className="space-y-2 py-4 text-center text-xs text-destructive">
                    <p>{t.finances.bank.loadBanksErr}</p>
                    <Button size="sm" variant="outline" disabled={institutionsQuery.isFetching || busy} onClick={() => void institutionsQuery.refetch()}>{t.common.retry}</Button>
                  </div>
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
                          disabled={busy}
                          className="flex min-h-11 w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:border-border-strong hover:bg-surface-hover focus-ring disabled:opacity-60 md:min-h-10"
                        >
                          {inst.logo && /^https:\/\//i.test(inst.logo) ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={inst.logo}
                              referrerPolicy="no-referrer"
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
function FioTokenForm({ onSaved, onBusyChange }: { onSaved: (synced: boolean) => void; onBusyChange: (busy: boolean) => void }) {
  const t = useDict();
  const toast = useToast();
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [savedConnectionId, setSavedConnectionId] = useState<string | null>(null);
  const storedQuery = useQuery({
    queryKey: ["bank", "credentials"], retry: false,
    queryFn: async ({ signal }) => {
      const res = await fetch("/api/bank/credentials", { cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
      if (!res.ok) throw new Error(String(res.status));
      return z.object({ stored: z.object({ fio: z.boolean() }) }).parse(await res.json()).stored.fio;
    },
  });

  // A credential must not be retained in React Query's mutation variables/cache.
  // Saving and verification are distinct receipts; a failed pull can be retried
  // with the confirmed connection id, without posting the credential again.
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    const value = token.trim();
    if (!savedConnectionId && (value.length < 16 || value.length > 512)) { setError(t.finances.bank.fioInvalid); return; }
    savingRef.current = true; setSaving(true); onBusyChange(true); setError(null);
    let connectionId = savedConnectionId;
    try {
      if (!connectionId) {
        const res = await fetch("/api/bank/credentials", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "fio", token: value }), signal: AbortSignal.timeout(30_000),
        });
        if (!res.ok) throw new Error("Store not confirmed");
        const receipt = z.object({ ok: z.literal(true), connectionId: z.uuid() }).parse(await res.json());
        connectionId = receipt.connectionId; setSavedConnectionId(connectionId); setToken("");
      }
      const response = await fetch("/api/bank/sync", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ connectionId }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error("Sync not confirmed");
      z.object({ inserted: z.number().int().nonnegative() }).parse(await response.json());
      toast.ok(t.finances.bank.fioSaved);
      onSaved(true);
    } catch { setError(connectionId ? t.finances.bank.fioSyncErr : t.finances.bank.fioErr); if (connectionId) onSaved(false); }
    finally { savingRef.current = false; setSaving(false); onBusyChange(false); }
  }
  return (
    <form className="mt-4 space-y-3" onSubmit={submit}>
      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="fio-token">{t.finances.bank.fioTitle}</label>
        <Input id="fio-token" type="password" autoComplete="off" value={token} disabled={saving || savedConnectionId !== null}
          maxLength={512} onChange={event => setToken(event.target.value)} placeholder={t.finances.bank.fioPlaceholder} />
        <p className="text-[11px] text-foreground-subtle">{t.finances.bank.serverSideOnly}</p>
        {(storedQuery.data === true || savedConnectionId) && <p role="status" className="text-xs text-foreground-muted">{t.finances.bank.fioStored}</p>}
        {storedQuery.isError && <div role="alert" className="space-y-1 text-xs text-destructive">
          <p>{t.finances.bank.credentialsLoadErr}</p><Button size="sm" variant="outline" disabled={saving || storedQuery.isFetching} onClick={() => void storedQuery.refetch()}>{t.common.retry}</Button>
        </div>}
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="submit" size="sm" disabled={saving || (!savedConnectionId && !token.trim())}>
        {saving ? t.finances.bank.fioSaving : savedConnectionId ? t.finances.bank.syncNow : t.finances.bank.fioSave}
      </Button>
    </form>
  );
}
