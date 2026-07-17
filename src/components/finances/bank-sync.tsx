"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import {
  Building2,
  Landmark,
  Plus,
  RefreshCw,
  Search,
  Unlink,
  Upload,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { fetchBankConnections } from "@/lib/queries/fetchers";
import { parseBankCsv, type ParseResult } from "@/lib/bank-csv";
import type { BankConnection, Transaction } from "@/lib/types";
import { cn } from "@/lib/utils";

type Institution = { id: string; name: string; bic: string | null; logo: string | null };

export function BankSync({ transactions }: { transactions: Transaction[] }) {
  const t = useDict();
  const qc = useQueryClient();
  const toast = useToast();
  const [pickerOpen, setPickerOpen] = useState(false);

  const connectionsQuery = useQuery({
    queryKey: qk.bankConnections,
    queryFn: fetchBankConnections,
  });
  const connections = connectionsQuery.data ?? [];

  // Pull the latest balances + transactions from every linked bank.
  const syncMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/bank/sync", { method: "POST" });
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
      syncMutation.mutate();
    } else if (outcome === "error") {
      toast.err(t.finances.bank.linkErrToast);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className={cn("h-3.5 w-3.5", syncMutation.isPending && "animate-spin")} />
              {syncMutation.isPending ? t.finances.bank.syncing : t.finances.bank.syncNow}
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
                onDisconnect={() => {
                  if (window.confirm(t.finances.bank.disconnectConfirm))
                    disconnectMutation.mutate(c.id);
                }}
                disconnecting={disconnectMutation.isPending}
              />
            ))}
          </ul>
        )}

        <CsvImport transactions={transactions} />
      </CardContent>

      <BankPickerDialog open={pickerOpen} onOpenChange={setPickerOpen} />
    </Card>
  );
}

/* ------------------------------ connection row ---------------------------- */

function ConnectionRow({
  conn,
  onDisconnect,
  disconnecting,
}: {
  conn: BankConnection;
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
  return (
    <li className="group flex items-center gap-3 px-2 py-2.5">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-foreground-muted">
        <Building2 className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {conn.institution_name ?? conn.institution_id}
        </p>
        <p className="text-[11px] text-foreground-subtle tabular">
          {conn.last_synced_at
            ? t.finances.bank.lastSynced(conn.last_synced_at.slice(0, 10))
            : t.finances.bank.neverSynced}
        </p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium", tone)}>
        {statusLabel}
      </span>
      <Tooltip content={t.finances.bank.disconnect}>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onDisconnect}
          disabled={disconnecting}
          aria-label={t.finances.bank.disconnect}
          className="opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <Unlink className="h-3.5 w-3.5 text-destructive" />
        </Button>
      </Tooltip>
    </li>
  );
}

/* -------------------------------- CSV import ------------------------------ */

function CsvImport({ transactions }: { transactions: Transaction[] }) {
  const t = useDict();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);

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
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("no-user");

      // Skip anything we already hold (dedupe on external_id).
      const existing = new Set(
        transactions.map((tx) => tx.external_id).filter(Boolean) as string[],
      );
      const fresh = parsed.rows.filter((r) => !existing.has(r.external_id));
      if (fresh.length === 0) {
        return { added: 0, dup: parsed.rows.length };
      }
      const payload = fresh.map((r) => ({
        user_id: userId,
        account_id: null,
        kind: r.kind,
        amount: r.amount,
        currency: r.currency,
        category: null,
        note: r.note,
        occurred_on: r.occurred_on,
        external_id: r.external_id,
      }));
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
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);

  const institutionsQuery = useQuery({
    queryKey: ["bank", "institutions", "cz"],
    enabled: open,
    queryFn: async () => {
      const res = await fetch("/api/bank/institutions?country=cz");
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
        body: JSON.stringify({ institutionId: inst.id, institutionName: inst.name }),
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

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-fade fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" />
        <Dialog.Content className="anim-dialog fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-surface p-5 shadow-elevated">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Dialog.Title className="text-sm font-semibold">
                {t.finances.bank.pickBank}
              </Dialog.Title>
              <Dialog.Description className="mt-1 text-xs text-foreground-muted">
                {t.finances.bank.pickBankDesc}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <button
                aria-label={t.common.cancel}
                className="rounded p-1 text-foreground-subtle hover:bg-surface-hover hover:text-foreground focus-ring"
              >
                <X className="h-4 w-4" />
              </button>
            </Dialog.Close>
          </div>

          {notConfigured ? (
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
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
