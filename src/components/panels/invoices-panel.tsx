"use client";

import { useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Check,
  Copy,
  FileUp,
  Loader2,
  Plus,
  Receipt,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader, SectionLabel } from "@/components/ui/page-header";
import { Tooltip } from "@/components/ui/tooltip";
import { useToast } from "@/components/ui/toast";
import { useConfirmation } from "@/components/ui/confirmation-dialog";
import { StatusBadge } from "@/components/invoices/status-badge";
import { InvoiceEditor } from "@/components/invoices/invoice-editor";
import { InvoiceDetail } from "@/components/invoices/invoice-detail";
import { SupplierSettings } from "@/components/invoices/supplier-settings";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
import { setInvoicePaymentState, InvoicePaymentChangeError, type InvoicePaymentChange } from "@/lib/invoice-payment-state";
import { todayKey } from "@/lib/date-keys";
import { convert } from "@/lib/fx";
import { computeTotals, effectiveStatus } from "@/lib/invoices";
import { extractPdfText } from "@/lib/pdf-extract";
import { parseInvoiceText, type ParsedInvoice } from "@/lib/invoice-parser";
import { formatCurrency } from "@/lib/utils";
import { useNow } from "@/lib/use-now";
import { useDict } from "@/lib/i18n";
import type {
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  Organization,
  Project,
  Transaction,
  Updater,
} from "@/lib/types";

type View =
  | { mode: "list" }
  | { mode: "new" }
  | { mode: "edit"; id: string }
  | { mode: "duplicate"; id: string }
  | { mode: "import"; prefill: ParsedInvoice }
  | { mode: "detail"; id: string }
  | { mode: "settings" };

function fmtDate(key: string): string {
  return format(parseISO(key), "d. M. yyyy");
}

export function InvoicesPanel({
  invoices,
  setInvoices,
  items,
  setItems,
  settings,
  setSettings,
  userId,
  displayCurrency,
  organizations,
  projects,
  transactions,
}: {
  invoices: Invoice[];
  setInvoices: Updater<Invoice[]>;
  items: InvoiceItem[];
  setItems: Updater<InvoiceItem[]>;
  settings: InvoiceSettings | null;
  setSettings: (s: InvoiceSettings) => void;
  userId: string;
  displayCurrency: string;
  organizations: Organization[];
  projects: Project[];
  /** Read-only: the bank payment that settled a paid invoice, when there is one. */
  transactions: Transaction[];
}) {
  const now = useNow();
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const confirm = useConfirmation();
  const [view, setView] = useState<View>({ mode: "list" });
  const [parsing, setParsing] = useState(false);
  const parsingRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Drag a PDF onto the list → extract text → parse → open the form prefilled.
  async function handleFile(file: File | undefined) {
    if (!file || parsingRef.current || setPaidMutation.isPending || removeMutation.isPending) return;
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name)) {
      toast.err(t.invoices.notPdf);
      return;
    }
    if (file.size > 20 * 1024 * 1024) { toast.err(t.invoices.pdfLimits); return; }
    parsingRef.current = true;
    setParsing(true);
    try {
      const text = await extractPdfText(file);
      const prefill = parseInvoiceText(text);
      setView({ mode: "import", prefill });
    } catch {
      toast.err(t.invoices.parseFailed);
    } finally {
      parsingRef.current = false;
      setParsing(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files?.[0]);
  }
  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (setPaidMutation.isPending || removeMutation.isPending) return;
    if (!dragging) setDragging(true);
  }
  function onDragLeave(e: React.DragEvent) {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDragging(false);
    }
  }

  // The payment that settled each invoice, so a paid row can say whether the
  // matcher found it or the owner linked it by hand.
  const paymentByInvoice = useMemo(() => {
    const map = new Map<string, Transaction>();
    for (const tx of transactions) {
      if (tx.invoice_id) map.set(tx.invoice_id, tx);
    }
    return map;
  }, [transactions]);

  // Per-invoice total (in the invoice's own currency) + a display-currency
  // conversion for the summary tiles.
  const totalsById = useMemo(() => {
    const byInvoice = new Map<string, InvoiceItem[]>();
    for (const it of items) {
      const arr = byInvoice.get(it.invoice_id) ?? [];
      arr.push(it);
      byInvoice.set(it.invoice_id, arr);
    }
    const map = new Map<string, { own: number; display: number }>();
    for (const inv of invoices) {
      const its = (byInvoice.get(inv.id) ?? []).map((it) => ({
        quantity: Number(it.quantity) || 0,
        unit_price: Number(it.unit_price) || 0,
        vat_rate: Number(it.vat_rate) || 0,
      }));
      const own = computeTotals(its, {
        roundTotal: inv.round_total,
        currency: inv.currency,
      }).total;
      map.set(inv.id, {
        own,
        display: convert(own, inv.currency, displayCurrency),
      });
    }
    return map;
  }, [invoices, items, displayCurrency]);

  const summary = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    let paid = 0;
    let outstandingCount = 0;
    let overdueCount = 0;
    for (const inv of invoices) {
      const d = totalsById.get(inv.id)?.display ?? 0;
      const eff = now ? effectiveStatus(inv, now) : inv.status;
      if (eff === "issued" || eff === "overdue") {
        outstanding += d;
        outstandingCount += 1;
      }
      if (eff === "overdue") {
        overdue += d;
        overdueCount += 1;
      }
      if (eff === "paid") paid += d;
    }
    return { outstanding, overdue, paid, outstandingCount, overdueCount };
  }, [invoices, totalsById, now]);

  // Optimistic: flip status in the cache before the await, roll back on error,
  // reconcile via invalidate once settled.
  const setPaidMutation = useMutation({
    mutationFn: (change: InvoicePaymentChange) => setInvoicePaymentState(supabase, change),
    onMutate: async ({ inv, paid, paidOn }) => {
      await qc.cancelQueries({ queryKey: qk.invoices });
      const prev = qc.getQueryData<Invoice[]>(qk.invoices)?.find((item) => item.id === inv.id) ?? inv;
      const patch = paid
        ? { status: "paid" as const, paid_on: paidOn }
        : { status: "issued" as const, paid_on: null };
      setInvoices((old) =>
        old.map((i) => (i.id === inv.id ? { ...i, ...patch } : i)),
      );
      return { prev };
    },
    onError: (error, { inv }, ctx) => {
      if (ctx?.prev) setInvoices((current) => current.map(item => item.id === inv.id ? { ...item, status: ctx.prev.status, paid_on: ctx.prev.paid_on } : item));
      toast.err(error instanceof InvoicePaymentChangeError && error.conflict ? t.invoices.paymentConflict : t.invoices.paymentChangeErr);
    },
    onSuccess: ({ invoice: saved, unlinkedIds }, { paid }) => {
      setInvoices(current => current.map(item => item.id === saved.id ? saved : item));
      const released = new Set(unlinkedIds);
      if (released.size) qc.setQueryData<Transaction[]>(qk.transactions, current => current?.map(tx => released.has(tx.id)
        ? { ...tx, invoice_id: null, matched_at: null, match_source: null } : tx));
      toast.ok(paid ? t.invoices.markedPaidToast : t.invoices.markedUnpaidToast);
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: qk.invoices }), qc.invalidateQueries({ queryKey: qk.transactions })]),
  });

  function setPaid(inv: Invoice, paid: boolean) {
    if (!parsingRef.current && !setPaidMutation.isPending && !removeMutation.isPending) setPaidMutation.mutate({ inv, paid, ownerId: userId, paidOn: paid ? todayKey() : null });
  }

  // Optimistic delete: drop the invoice and its items from the cache before the
  // await; the DB cascade removes the items server-side.
  const removeMutation = useMutation({
    mutationFn: async (inv: Invoice) => {
      const { data, error } = await supabase.from("invoices").delete().eq("id", inv.id).eq("updated_at", inv.updated_at).select("id").single();
      if (error || data?.id !== inv.id) throw new Error("Invoice deletion unconfirmed");
    },
    onMutate: async (inv) => {
      await qc.cancelQueries({ queryKey: qk.invoices });
      await qc.cancelQueries({ queryKey: qk.invoiceItems });
      const prevInvoice = qc.getQueryData<Invoice[]>(qk.invoices)?.find((item) => item.id === inv.id) ?? inv;
      const prevItems = (qc.getQueryData<InvoiceItem[]>(qk.invoiceItems) ?? items).filter((item) => item.invoice_id === inv.id);
      setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
      setItems((prev) => prev.filter((i) => i.invoice_id !== inv.id));
      setView({ mode: "list" });
      return { prevInvoice, prevItems, prevView: view };
    },
    onError: (_error, inv, ctx) => {
      if (ctx?.prevInvoice) setInvoices((current) => current.some((item) => item.id === inv.id) ? current : [ctx.prevInvoice, ...current]);
      if (ctx?.prevItems) setItems((current) => [...current.filter((item) => item.invoice_id !== inv.id), ...ctx.prevItems]);
      if (ctx?.prevView) setView(current => current.mode === "list" ? ctx.prevView : current);
      toast.err(t.invoices.deleteErr);
    },
    onSuccess: () => toast.ok(t.invoices.deletedToast),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.invoices });
      void qc.invalidateQueries({ queryKey: qk.invoiceItems });
      void qc.invalidateQueries({ queryKey: qk.transactions });
    },
  });

  async function remove(inv: Invoice) {
    if (await confirm({
      title: t.common.delete,
      description: t.invoices.deleteConfirm(inv.number),
      confirmLabel: t.common.delete,
      cancelLabel: t.common.cancel,
      destructive: true,
    }) && !parsingRef.current && !setPaidMutation.isPending && !removeMutation.isPending) removeMutation.mutate(inv);
  }

  // ── Sub-views ────────────────────────────────────────────────────────────

  if (view.mode === "settings") {
    return (
      <SupplierSettings
        settings={settings}
        userId={userId}
        onSaved={setSettings}
        onBack={() => setView({ mode: "list" })}
      />
    );
  }

  if (view.mode === "new" || view.mode === "import") {
    return (
      <InvoiceEditor
        mode={view.mode === "import" ? "import" : "create"}
        prefill={view.mode === "import" ? view.prefill : undefined}
        settings={settings}
        userId={userId}
        existingInvoices={invoices}
        setInvoices={setInvoices}
        setItems={setItems}
        organizations={organizations}
        projects={projects}
        onCancel={() => setView({ mode: "list" })}
        onDone={(id) => setView({ mode: "detail", id })}
        onSettingsSaved={setSettings}
      />
    );
  }

  if (view.mode === "edit" || view.mode === "duplicate") {
    const src = invoices.find((i) => i.id === view.id);
    if (src) {
      return (
        <InvoiceEditor
          mode={view.mode === "edit" ? "edit" : "duplicate"}
          source={{
            invoice: src,
            items: items.filter((it) => it.invoice_id === src.id),
          }}
          settings={settings}
          userId={userId}
          existingInvoices={invoices}
          setInvoices={setInvoices}
          setItems={setItems}
          organizations={organizations}
          projects={projects}
          onCancel={() => setView({ mode: "list" })}
          onDone={(id) => setView({ mode: "detail", id })}
          onSettingsSaved={setSettings}
        />
      );
    }
    // Source vanished (e.g. deleted) — fall through to the list.
  }

  // When a detail's invoice still exists, show it; otherwise fall through to
  // the list (e.g. it was just deleted) — no setState during render.
  const detailInvoice =
    view.mode === "detail"
      ? invoices.find((i) => i.id === view.id)
      : undefined;
  if (detailInvoice) {
    return (
      <InvoiceDetail
        invoice={detailInvoice}
        busy={setPaidMutation.isPending || removeMutation.isPending}
        items={items.filter((i) => i.invoice_id === detailInvoice.id)}
        logo={settings?.logo ?? null}
        onBack={() => setView({ mode: "list" })}
        onEdit={() => setView({ mode: "edit", id: detailInvoice.id })}
        onDuplicate={() => setView({ mode: "duplicate", id: detailInvoice.id })}
        onMarkPaid={() => setPaid(detailInvoice, true)}
        onMarkUnpaid={() => setPaid(detailInvoice, false)}
        onDelete={() => remove(detailInvoice)}
      />
    );
  }

  // ── List ─────────────────────────────────────────────────────────────────

  return (
    <fieldset
      disabled={parsing || setPaidMutation.isPending || removeMutation.isPending}
      aria-label={t.invoices.title}
      className="relative min-w-0"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center rounded-lg border-2 border-dashed border-foreground/40 bg-background/80 backdrop-blur-sm">
          <p className="inline-flex items-center gap-2 text-sm font-medium">
            <FileUp className="h-4 w-4" /> {t.invoices.dropOverlay}
          </p>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          void handleFile(f);
        }}
      />

      <PageHeader
        title={t.invoices.title}
        description={t.invoices.description}
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setView({ mode: "settings" })}
            >
              <Settings className="h-3.5 w-3.5" /> {t.invoices.settings}
            </Button>
            <Button size="sm" onClick={() => setView({ mode: "new" })}>
              <Plus className="h-3.5 w-3.5" /> {t.invoices.newInvoice}
            </Button>
          </div>
        }
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={parsing || setPaidMutation.isPending || removeMutation.isPending}
        className="mb-4 flex w-full items-center justify-center gap-2.5 rounded-lg border border-dashed border-border-strong bg-surface-muted/40 px-4 py-3 text-sm transition-colors hover:border-foreground/30 focus-ring disabled:opacity-60"
      >
        {parsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin text-foreground-muted" />
            <span className="text-foreground-muted">{t.invoices.parsing}</span>
          </>
        ) : (
          <>
            <FileUp className="h-4 w-4 text-foreground-muted" />
            <span>
              <span className="font-medium text-foreground">
                {t.invoices.dropTitle}
              </span>{" "}
              <span className="text-foreground-subtle">
                {t.invoices.dropHint}
              </span>
            </span>
          </>
        )}
      </button>

      {invoices.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3 mb-4">
          <SummaryTile
            label={t.invoices.outstanding}
            value={formatCurrency(summary.outstanding, displayCurrency)}
            hint={t.invoices.statusLabel.issued}
            count={summary.outstandingCount}
          />
          <SummaryTile
            label={t.invoices.overdueSummary}
            value={formatCurrency(summary.overdue, displayCurrency)}
            hint={t.invoices.statusLabel.overdue}
            count={summary.overdueCount}
            tone={summary.overdue > 0 ? "danger" : undefined}
          />
          <SummaryTile
            label={t.invoices.paidSummary}
            value={formatCurrency(summary.paid, displayCurrency)}
            hint={t.invoices.statusLabel.paid}
          />
        </div>
      )}

      <Card>
        <CardContent className="pt-5">
          {invoices.length === 0 ? (
            <EmptyState
              icon={Receipt}
              title={t.invoices.emptyTitle}
              description={t.invoices.emptyDesc}
              action={
                <Button size="sm" onClick={() => setView({ mode: "new" })}>
                  <Plus className="h-3.5 w-3.5" /> {t.invoices.createFirst}
                </Button>
              }
            />
          ) : (
            <ul className="-mx-2 divide-y divide-border">
              {invoices.map((inv) => {
                const eff = now ? effectiveStatus(inv, now) : inv.status;
                const own = totalsById.get(inv.id)?.own ?? 0;
                const payment = paymentByInvoice.get(inv.id);
                return (
                  <li
                    key={inv.id}
                    className="group flex flex-wrap items-center gap-2 px-2 py-2.5 row-hover sm:gap-3"
                  >
                    <button
                      type="button"
                      disabled={setPaidMutation.isPending || removeMutation.isPending}
                      onClick={() => setView({ mode: "detail", id: inv.id })}
                      className="flex min-w-0 basis-full items-center gap-3 text-left focus-ring rounded-md sm:flex-1 sm:basis-auto"
                    >
                      <span className="h-8 w-8 shrink-0 rounded-md bg-surface-muted text-foreground-muted inline-flex items-center justify-center">
                        <Receipt className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          <span className="tabular">{inv.number}</span>
                          <span className="text-foreground-subtle">
                            {" · "}
                            {inv.buyer_name || t.invoices.buyerFallback}
                          </span>
                        </p>
                        <p className="text-[11px] text-foreground-subtle tabular">
                          {t.invoices.issuedOn} {fmtDate(inv.issue_date)} ·{" "}
                          {t.invoices.dueOn} {fmtDate(inv.due_date)}
                        </p>
                        {payment && (
                          <p className="text-[11px] text-foreground-subtle tabular">
                            {payment.match_source === "manual"
                              ? t.invoices.matchedManual(fmtDate(payment.occurred_on))
                              : t.invoices.matchedAuto(fmtDate(payment.occurred_on))}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-2 sm:gap-3">
                      <span className="text-sm font-medium tabular whitespace-nowrap">
                        {formatCurrency(own, inv.currency)}
                      </span>
                      <StatusBadge status={eff} />
                      <div className="flex transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                        <Tooltip content={t.invoices.duplicate}>
                          <Button
                            disabled={setPaidMutation.isPending || removeMutation.isPending}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              setView({ mode: "duplicate", id: inv.id })
                            }
                            aria-label={`${t.invoices.duplicate}: ${inv.number}`}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                        {inv.status === "paid" ? (
                          <Tooltip content={t.invoices.markUnpaid}>
                            <Button
                              disabled={setPaidMutation.isPending || removeMutation.isPending}
                            size="icon-sm"
                              variant="ghost"
                              onClick={() => setPaid(inv, false)}
                              aria-label={`${t.invoices.markUnpaid}: ${inv.number}`}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip content={t.invoices.markPaid}>
                            <Button
                              disabled={setPaidMutation.isPending || removeMutation.isPending}
                            size="icon-sm"
                              variant="ghost"
                              onClick={() => setPaid(inv, true)}
                              aria-label={`${t.invoices.markPaid}: ${inv.number}`}
                            >
                              <Check className="h-3.5 w-3.5 text-success" />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content={t.invoices.delete}>
                          <Button
                            disabled={setPaidMutation.isPending || removeMutation.isPending}
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => remove(inv)}
                            aria-label={`${t.invoices.delete}: ${inv.number}`}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </Tooltip>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </fieldset>
  );
}

function SummaryTile({
  label,
  value,
  hint,
  count,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  count?: number;
  tone?: "danger";
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <SectionLabel>{label}</SectionLabel>
        <p
          className={
            "mt-1 text-2xl font-semibold tracking-tight tabular " +
            (tone === "danger" ? "text-destructive" : "text-foreground")
          }
        >
          {value}
        </p>
        <p className="text-[11px] text-foreground-subtle mt-0.5">
          {count !== undefined ? `${count} · ${hint}` : hint}
        </p>
      </CardContent>
    </Card>
  );
}
