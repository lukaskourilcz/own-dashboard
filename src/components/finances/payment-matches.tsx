"use client";

import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link2, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SimpleSelect } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { useDict } from "@/lib/i18n";
import { qk } from "@/lib/queries/keys";
import { computeTotals } from "@/lib/invoices";
import { matchPayments, type UnmatchedPayment } from "@/lib/payment-matching";
import { formatCurrency } from "@/lib/utils";
import type { Invoice, InvoiceItem, Transaction } from "@/lib/types";

/**
 * Incoming payments the matcher could not pair with an invoice, each with the
 * reason and a way to link it by hand.
 *
 * The list is derived in the browser from the records the dashboard already
 * loaded, using the same `matchPayments` the cron runs — so the card is honest
 * about the loaded window without a round trip. Writing is always a server
 * round trip: "Match now" runs the matcher over the whole ledger, and "Link"
 * settles one invoice with that payment's own date.
 */
export function PaymentMatches({
  transactions,
  invoices,
  invoiceItems,
}: {
  transactions: Transaction[];
  invoices: Invoice[];
  // Every row prints the invoice's own currency, so there is no display
  // currency here: converting a payment would hide the currency mismatch the
  // card exists to explain.
  invoiceItems: InvoiceItem[];
}) {
  const t = useDict();
  const qc = useQueryClient();
  const toast = useToast();
  const [choice, setChoice] = useState<Record<string, string>>({});

  // Only bank invoices can be settled by a transfer; cash and card never carry
  // a variable symbol.
  const bankInvoices = useMemo(
    () => invoices.filter((invoice) => invoice.payment_method === "bank"),
    [invoices],
  );

  const totals = useMemo(() => {
    const byInvoice = new Map<string, InvoiceItem[]>();
    for (const item of invoiceItems) {
      const bucket = byInvoice.get(item.invoice_id);
      if (bucket) bucket.push(item);
      else byInvoice.set(item.invoice_id, [item]);
    }
    const map = new Map<string, number>();
    for (const invoice of bankInvoices) {
      const { total } = computeTotals(
        (byInvoice.get(invoice.id) ?? []).map((item) => ({
          quantity: Number(item.quantity),
          unit_price: Number(item.unit_price),
          vat_rate: Number(item.vat_rate),
        })),
        { roundTotal: invoice.round_total, currency: invoice.currency },
      );
      map.set(invoice.id, total);
    }
    return map;
  }, [bankInvoices, invoiceItems]);

  const openInvoices = useMemo(
    () => bankInvoices.filter((invoice) => invoice.status === "issued"),
    [bankInvoices],
  );

  const unmatched = useMemo(() => {
    if (openInvoices.length === 0) return [];
    return matchPayments({
      invoices: bankInvoices,
      totals,
      transactions,
    }).unmatched;
  }, [bankInvoices, openInvoices.length, totals, transactions]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/money/payment-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "auto" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      return (await res.json()) as { linked: number };
    },
    onSuccess: ({ linked }) => {
      toast.ok(linked > 0 ? t.finances.matching.matchDone(linked) : t.finances.matching.matchNothing);
      if (linked > 0) {
        void qc.invalidateQueries({ queryKey: qk.transactions });
        void qc.invalidateQueries({ queryKey: qk.invoices });
        void qc.invalidateQueries({ queryKey: qk.notifications });
      }
    },
    onError: () => toast.err(t.finances.matching.matchErr),
  });

  const linkMutation = useMutation({
    mutationFn: async (input: { transactionId: string; invoiceId: string }) => {
      const res = await fetch("/api/money/payment-match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "link", ...input }),
      });
      if (!res.ok) throw new Error(String(res.status));
    },
    onSuccess: (_data, input) => {
      toast.ok(t.finances.matching.linkDone);
      setChoice((prev) => {
        const next = { ...prev };
        delete next[input.transactionId];
        return next;
      });
      void qc.invalidateQueries({ queryKey: qk.transactions });
      void qc.invalidateQueries({ queryKey: qk.invoices });
    },
    onError: () => toast.err(t.finances.matching.linkErr),
  });

  const invoiceOptions = useMemo(
    () =>
      openInvoices.map((invoice) => ({
        value: invoice.id,
        label: t.finances.matching.invoiceOption(
          invoice.number,
          formatCurrency(totals.get(invoice.id) ?? 0, invoice.currency),
        ),
      })),
    [openInvoices, totals, t],
  );

  return (
    <Card className="lg:col-span-3">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="inline-flex items-center gap-1.5">
            <Receipt className="h-3 w-3" /> {t.finances.matching.title}
          </CardTitle>
          <p className="mt-1 text-xs normal-case tracking-normal text-foreground-subtle">
            {t.finances.matching.subtitle}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => runMutation.mutate()}
          disabled={runMutation.isPending || openInvoices.length === 0}
        >
          <Link2 className="h-3.5 w-3.5" />
          {runMutation.isPending ? t.finances.matching.matching : t.finances.matching.matchNow}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {openInvoices.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t.finances.matching.empty}
            description={t.finances.matching.noOpenInvoices}
          />
        ) : unmatched.length === 0 ? (
          <EmptyState
            icon={Receipt}
            title={t.finances.matching.empty}
            description={t.finances.matching.emptyHint}
          />
        ) : (
          <>
            <p className="text-[11px] text-foreground-subtle">
              {t.finances.matching.unmatchedCount(unmatched.length)} · {t.finances.matching.scheduleHint}
            </p>
            <ul className="-mx-2 divide-y divide-border">
              {unmatched.map((payment) => (
                <UnmatchedRow
                  key={payment.transaction.id}
                  payment={payment}
                  options={invoiceOptions}
                  value={choice[payment.transaction.id] ?? ""}
                  onChange={(value) =>
                    setChoice((prev) => ({ ...prev, [payment.transaction.id]: value }))
                  }
                  onLink={(invoiceId) =>
                    linkMutation.mutate({ transactionId: payment.transaction.id, invoiceId })
                  }
                  // Only the row being written is busy; the rest stay usable.
                  busy={
                    linkMutation.isPending &&
                    linkMutation.variables?.transactionId === payment.transaction.id
                  }
                />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function UnmatchedRow({
  payment,
  options,
  value,
  onChange,
  onLink,
  busy,
}: {
  payment: UnmatchedPayment;
  options: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
  onLink: (invoiceId: string) => void;
  busy: boolean;
}) {
  const t = useDict();
  const tx = payment.transaction;
  // A leftover that already points at one invoice pre-selects it, so the owner
  // confirms rather than searches.
  const selected = value || payment.invoiceId || "";
  // Every row carries the same two controls, so each accessible name names the
  // payment it acts on rather than repeating "Link" down the list.
  const rowLabel = `${formatCurrency(tx.amount, tx.currency)}, ${tx.occurred_on}`;
  return (
    <li className="flex flex-wrap items-center gap-2 px-2 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {formatCurrency(tx.amount, tx.currency)}
          <span className="ml-2 font-normal text-foreground-muted">{tx.note ?? "—"}</span>
        </p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] tabular text-foreground-subtle">
          <span>{tx.occurred_on}</span>
          <span>
            {t.finances.matching.vsLabel}:{" "}
            {payment.variableSymbol ?? t.finances.matching.vsNone}
          </span>
          <span className="rounded-full bg-surface-muted px-2 py-[2px] text-foreground-muted">
            {t.finances.matching.reason[payment.reason]}
          </span>
        </p>
      </div>
      {/* Full width below sm so a 320 px viewport wraps instead of overflowing. */}
      <div className="flex w-full items-center gap-1.5 sm:w-auto sm:shrink-0">
        <SimpleSelect
          value={selected}
          onValueChange={onChange}
          options={options}
          placeholder={t.finances.matching.chooseInvoice}
          aria-label={`${t.finances.matching.chooseInvoice} — ${rowLabel}`}
          className="h-8 min-w-0 flex-1 text-xs sm:w-[13rem] sm:flex-none"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={!selected || busy}
          aria-label={`${t.finances.matching.link} — ${rowLabel}`}
          onClick={() => selected && onLink(selected)}
        >
          {busy ? t.finances.matching.linking : t.finances.matching.link}
        </Button>
      </div>
    </li>
  );
}
