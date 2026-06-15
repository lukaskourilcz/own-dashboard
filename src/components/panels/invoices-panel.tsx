"use client";

import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  Check,
  Copy,
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
import { StatusBadge } from "@/components/invoices/status-badge";
import { InvoiceForm } from "@/components/invoices/invoice-form";
import { InvoiceDetail } from "@/components/invoices/invoice-detail";
import { SupplierSettings } from "@/components/invoices/supplier-settings";
import { createClient } from "@/lib/supabase/client";
import { todayKey } from "@/lib/date-keys";
import { convert } from "@/lib/fx";
import { computeTotals, effectiveStatus } from "@/lib/invoices";
import { formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type {
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  Updater,
} from "@/lib/types";

type View =
  | { mode: "list" }
  | { mode: "new" }
  | { mode: "edit"; id: string }
  | { mode: "duplicate"; id: string }
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
}: {
  invoices: Invoice[];
  setInvoices: Updater<Invoice[]>;
  items: InvoiceItem[];
  setItems: Updater<InvoiceItem[]>;
  settings: InvoiceSettings | null;
  setSettings: (s: InvoiceSettings) => void;
  userId: string;
  displayCurrency: string;
}) {
  const supabase = createClient();
  const toast = useToast();
  const t = useDict();
  const [view, setView] = useState<View>({ mode: "list" });

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
      const eff = effectiveStatus(inv);
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
  }, [invoices, totalsById]);

  async function setPaid(inv: Invoice, paid: boolean) {
    const patch = paid
      ? { status: "paid" as const, paid_on: todayKey() }
      : { status: "issued" as const, paid_on: null };
    setInvoices((prev) =>
      prev.map((i) => (i.id === inv.id ? { ...i, ...patch } : i)),
    );
    const { error } = await supabase
      .from("invoices")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", inv.id);
    if (error) {
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? inv : i)));
      toast.err(error.message);
      return;
    }
    toast.ok(paid ? t.invoices.markedPaidToast : t.invoices.markedUnpaidToast);
  }

  async function remove(inv: Invoice) {
    if (!window.confirm(t.invoices.deleteConfirm(inv.number))) return;
    setInvoices((prev) => prev.filter((i) => i.id !== inv.id));
    setItems((prev) => prev.filter((i) => i.invoice_id !== inv.id));
    setView({ mode: "list" });
    const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
    if (error) toast.err(error.message);
    else toast.ok(t.invoices.deletedToast);
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

  if (view.mode === "new") {
    return (
      <InvoiceForm
        mode="create"
        settings={settings}
        userId={userId}
        existingInvoices={invoices}
        setInvoices={setInvoices}
        setItems={setItems}
        onCancel={() => setView({ mode: "list" })}
        onDone={(id) => setView({ mode: "detail", id })}
        onEditSupplier={() => setView({ mode: "settings" })}
      />
    );
  }

  if (view.mode === "edit" || view.mode === "duplicate") {
    const src = invoices.find((i) => i.id === view.id);
    if (src) {
      return (
        <InvoiceForm
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
          onCancel={() => setView({ mode: "list" })}
          onDone={(id) => setView({ mode: "detail", id })}
          onEditSupplier={() => setView({ mode: "settings" })}
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
    <div>
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
                const eff = effectiveStatus(inv);
                const own = totalsById.get(inv.id)?.own ?? 0;
                return (
                  <li
                    key={inv.id}
                    className="group flex items-center gap-3 px-2 py-2.5 row-hover"
                  >
                    <button
                      type="button"
                      onClick={() => setView({ mode: "detail", id: inv.id })}
                      className="flex flex-1 items-center gap-3 min-w-0 text-left focus-ring rounded-md"
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
                      </div>
                    </button>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-sm font-medium tabular whitespace-nowrap">
                        {formatCurrency(own, inv.currency)}
                      </span>
                      <StatusBadge status={eff} />
                      <div className="flex opacity-0 group-hover:opacity-100 transition-opacity">
                        <Tooltip content={t.invoices.duplicate}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() =>
                              setView({ mode: "duplicate", id: inv.id })
                            }
                            aria-label={t.invoices.duplicate}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </Tooltip>
                        {inv.status === "paid" ? (
                          <Tooltip content={t.invoices.markUnpaid}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setPaid(inv, false)}
                              aria-label={t.invoices.markUnpaid}
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </Tooltip>
                        ) : (
                          <Tooltip content={t.invoices.markPaid}>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => setPaid(inv, true)}
                              aria-label={t.invoices.markPaid}
                            >
                              <Check className="h-3.5 w-3.5 text-success" />
                            </Button>
                          </Tooltip>
                        )}
                        <Tooltip content={t.invoices.delete}>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            onClick={() => remove(inv)}
                            aria-label={t.invoices.delete}
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
    </div>
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
