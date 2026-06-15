"use client";

import { format, parseISO } from "date-fns";
import { QRCodeSVG } from "qrcode.react";
import {
  ArrowLeft,
  Check,
  Copy,
  Pencil,
  Printer,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/invoices/status-badge";
import {
  buildSpayd,
  computeTotals,
  effectiveStatus,
  lineBase,
  lineTotal,
  resolveIban,
} from "@/lib/invoices";
import { formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type { Invoice, InvoiceItem } from "@/lib/types";

function fmtDate(key: string | null): string {
  if (!key) return "—";
  return format(parseISO(key), "d. M. yyyy");
}

export function InvoiceDetail({
  invoice,
  items,
  logo,
  onBack,
  onEdit,
  onDuplicate,
  onMarkPaid,
  onMarkUnpaid,
  onDelete,
}: {
  invoice: Invoice;
  items: InvoiceItem[];
  logo: string | null;
  onBack: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onMarkPaid: () => void;
  onMarkUnpaid: () => void;
  onDelete: () => void;
}) {
  const t = useDict();
  const isVatPayer = invoice.supplier_is_vat_payer;
  const sorted = [...items].sort((a, b) => a.position - b.position);
  const parsed = sorted.map((it) => ({
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    vat_rate: Number(it.vat_rate) || 0,
  }));
  const totals = computeTotals(parsed, {
    roundTotal: invoice.round_total,
    currency: invoice.currency,
  });
  const eff = effectiveStatus(invoice);
  const iban = resolveIban(invoice);
  const spayd = iban
    ? buildSpayd({
        iban,
        amount: totals.total,
        currency: invoice.currency,
        variableSymbol: invoice.variable_symbol,
        constantSymbol: invoice.constant_symbol,
        message: `${t.invoices.numberLabel} ${invoice.number}`,
        dueDate: invoice.due_date,
      })
    : null;

  function money(value: number) {
    return formatCurrency(value, invoice.currency);
  }

  return (
    <div>
      {/* Toolbar — not printed */}
      <div className="no-print flex flex-wrap items-center gap-2 mb-4">
        <Button size="sm" variant="outline" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" /> {t.invoices.back}
        </Button>
        <StatusBadge status={eff} />
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" /> {t.invoices.edit}
          </Button>
          <Button size="sm" variant="outline" onClick={onDuplicate}>
            <Copy className="h-3.5 w-3.5" /> {t.invoices.duplicate}
          </Button>
          {invoice.status === "paid" ? (
            <Button size="sm" variant="outline" onClick={onMarkUnpaid}>
              <RotateCcw className="h-3.5 w-3.5" /> {t.invoices.markUnpaid}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={onMarkPaid}>
              <Check className="h-3.5 w-3.5" /> {t.invoices.markPaid}
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => window.print()}>
            <Printer className="h-3.5 w-3.5" /> {t.invoices.print}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDelete}
            aria-label={t.invoices.delete}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {!spayd && (
        <p className="no-print -mt-2 mb-4 text-xs text-foreground-subtle">
          {t.invoices.qrMissing}
        </p>
      )}

      {/* The document — fixed "paper" colours so it reads the same in dark mode
          and prints cleanly. */}
      <div className="invoice-print-area mx-auto max-w-3xl rounded-lg border border-neutral-200 bg-white text-neutral-900 shadow-soft">
        <div className="p-8 sm:p-12">
          {/* Header */}
          <div className="flex items-start justify-between gap-6 border-b border-neutral-200 pb-8">
            <div className="min-w-0">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt=""
                  className="h-16 max-w-[220px] object-contain"
                />
              ) : (
                <p className="text-lg font-semibold tracking-tight">
                  {invoice.supplier_name || "—"}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-neutral-400">
                {isVatPayer ? t.invoices.taxDocTitle : t.invoices.plainTitle}
              </p>
              <p className="mt-1.5 text-3xl font-bold tabular tracking-tight">
                {invoice.number}
              </p>
              {(eff === "paid" || eff === "overdue" || eff === "cancelled") && (
                <span
                  className={
                    "mt-2 inline-block rounded-md border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider " +
                    (eff === "paid"
                      ? "border-emerald-300 text-emerald-700"
                      : eff === "overdue"
                        ? "border-red-300 text-red-700"
                        : "border-neutral-300 text-neutral-500")
                  }
                >
                  {t.invoices.statusLabel[eff]}
                </span>
              )}
            </div>
          </div>

          {/* Parties */}
          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <Party
              label={t.invoices.supplierLabel}
              name={invoice.supplier_name}
              address={invoice.supplier_address}
              zip={invoice.supplier_zip}
              city={invoice.supplier_city}
              country={invoice.supplier_country}
              ico={invoice.supplier_ico}
              dic={invoice.supplier_dic}
              icoLabel={t.invoices.icoLabel}
              dicLabel={t.invoices.dicLabel}
            />
            <Party
              label={t.invoices.buyerLabel}
              name={invoice.buyer_name}
              address={invoice.buyer_address}
              zip={invoice.buyer_zip}
              city={invoice.buyer_city}
              country={invoice.buyer_country}
              ico={invoice.buyer_ico}
              dic={invoice.buyer_dic}
              icoLabel={t.invoices.icoLabel}
              dicLabel={t.invoices.dicLabel}
            />
          </div>

          {/* Payment + dates */}
          <div className="mt-8 grid gap-x-8 gap-y-2 rounded-lg border border-neutral-200 bg-neutral-50 p-5 text-sm sm:grid-cols-2">
            <Meta label={t.invoices.vsLabel} value={invoice.variable_symbol} />
            {invoice.constant_symbol && (
              <Meta label={t.invoices.ksLabel} value={invoice.constant_symbol} />
            )}
            <Meta
              label={t.invoices.paymentMethodLabel}
              value={t.invoices.paymentMethod[invoice.payment_method]}
            />
            <Meta
              label={t.invoices.issueDateLabel}
              value={fmtDate(invoice.issue_date)}
            />
            {isVatPayer && invoice.taxable_supply_date && (
              <Meta
                label={t.invoices.taxDateLabel}
                value={fmtDate(invoice.taxable_supply_date)}
              />
            )}
            <Meta
              label={t.invoices.dueDateLabel}
              value={fmtDate(invoice.due_date)}
            />
            {invoice.bank_account && (
              <Meta
                label={t.invoices.bankAccountLabel}
                value={invoice.bank_account}
              />
            )}
            {iban && <Meta label={t.invoices.ibanLabel} value={iban} />}
          </div>

          {/* Items */}
          <table className="mt-10 w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-[11px] uppercase tracking-wider text-neutral-400">
                <th className="py-2 pr-2 font-medium">
                  {t.invoices.thDescription}
                </th>
                <th className="py-2 px-2 font-medium text-right">
                  {t.invoices.thQuantity}
                </th>
                <th className="py-2 px-2 font-medium text-right">
                  {t.invoices.thUnitPrice}
                </th>
                {isVatPayer && (
                  <th className="py-2 px-2 font-medium text-right">
                    {t.invoices.thVat}
                  </th>
                )}
                <th className="py-2 pl-2 font-medium text-right">
                  {t.invoices.thLineTotal}
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((it, i) => (
                <tr key={it.id} className="border-b border-neutral-100 align-top">
                  <td className="py-2.5 pr-2">{it.description}</td>
                  <td className="py-2.5 px-2 text-right tabular whitespace-nowrap text-neutral-600">
                    {Number(it.quantity)} {it.unit ?? ""}
                  </td>
                  <td className="py-2.5 px-2 text-right tabular whitespace-nowrap text-neutral-600">
                    {money(Number(it.unit_price))}
                  </td>
                  {isVatPayer && (
                    <td className="py-2.5 px-2 text-right tabular text-neutral-600">
                      {Number(it.vat_rate)} %
                    </td>
                  )}
                  <td className="py-2.5 pl-2 text-right tabular whitespace-nowrap font-medium">
                    {money(isVatPayer ? lineTotal(parsed[i]) : lineBase(parsed[i]))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals + VAT recap */}
          <div className="mt-6 flex flex-col items-end gap-4">
            {isVatPayer && totals.breakdown.length > 0 && (
              <table className="text-sm w-full sm:w-auto sm:min-w-[18rem]">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-neutral-500 text-right">
                    <th className="py-1 pr-4 text-left font-medium">
                      {t.invoices.recapRate}
                    </th>
                    <th className="py-1 px-2 font-medium">
                      {t.invoices.recapBase}
                    </th>
                    <th className="py-1 px-2 font-medium">
                      {t.invoices.recapVat}
                    </th>
                    <th className="py-1 pl-2 font-medium">
                      {t.invoices.recapTotal}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {totals.breakdown.map((g) => (
                    <tr key={g.rate} className="text-right tabular">
                      <td className="py-1 pr-4 text-left">{g.rate} %</td>
                      <td className="py-1 px-2">{money(g.base)}</td>
                      <td className="py-1 px-2">{money(g.vat)}</td>
                      <td className="py-1 pl-2">{money(g.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <div className="w-full sm:w-72 space-y-1.5 text-sm">
              {isVatPayer && (
                <>
                  <DocRow
                    label={t.invoices.subtotalLabel}
                    value={money(totals.subtotal)}
                  />
                  <DocRow
                    label={t.invoices.vatTotalLabel}
                    value={money(totals.vatTotal)}
                  />
                </>
              )}
              {totals.rounding !== 0 && (
                <DocRow
                  label={t.invoices.roundingLabel}
                  value={money(totals.rounding)}
                />
              )}
              <div className="mt-2 flex items-center justify-between gap-6 rounded-lg border border-neutral-200 bg-neutral-50 px-4 py-3">
                <span className="text-sm font-semibold">
                  {t.invoices.totalToPayLabel}
                </span>
                <span className="text-2xl font-bold tabular tracking-tight">
                  {money(totals.total)}
                </span>
              </div>
            </div>
          </div>

          {!isVatPayer && (
            <p className="mt-6 text-sm text-neutral-500">
              {t.invoices.nonVatPayerNote}
            </p>
          )}

          {/* Payment + QR */}
          {spayd && (
            <div className="mt-8 flex flex-col sm:flex-row items-start gap-5 border-t border-neutral-200 pt-6">
              <div className="rounded-lg border border-neutral-200 bg-white p-3">
                <QRCodeSVG
                  value={spayd}
                  size={132}
                  level="M"
                  marginSize={0}
                  bgColor="#ffffff"
                  fgColor="#0a0a0a"
                />
              </div>
              <div className="text-sm">
                <p className="font-semibold">{t.invoices.qrTitle}</p>
                <p className="text-neutral-500 text-xs mt-0.5 max-w-xs">
                  {t.invoices.qrHint}
                </p>
                <div className="mt-3 space-y-0.5 text-xs tabular text-neutral-600">
                  {invoice.bank_account && (
                    <p>
                      {t.invoices.bankAccountLabel}: {invoice.bank_account}
                    </p>
                  )}
                  <p>
                    {t.invoices.vsLabel}: {invoice.variable_symbol ?? "—"}
                  </p>
                  <p className="font-medium text-neutral-900">
                    {t.invoices.totalToPayLabel}: {money(totals.total)}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Note + footer */}
          {(invoice.note || invoice.footer_note) && (
            <div className="mt-8 border-t border-neutral-200 pt-5 text-sm text-neutral-600 space-y-2">
              {invoice.note && <p className="whitespace-pre-wrap">{invoice.note}</p>}
              {invoice.footer_note && (
                <p className="whitespace-pre-wrap text-neutral-500">
                  {invoice.footer_note}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Party({
  label,
  name,
  address,
  zip,
  city,
  country,
  ico,
  dic,
  icoLabel,
  dicLabel,
}: {
  label: string;
  name: string;
  address: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  ico: string | null;
  dic: string | null;
  icoLabel: string;
  dicLabel: string;
}) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-neutral-400 mb-1">
        {label}
      </p>
      <p className="font-semibold">{name || "—"}</p>
      {address && <p className="text-neutral-600">{address}</p>}
      {(zip || city) && (
        <p className="text-neutral-600">
          {[zip, city].filter(Boolean).join(" ")}
        </p>
      )}
      {country && <p className="text-neutral-600">{country}</p>}
      <div className="mt-1 text-xs text-neutral-500 tabular space-y-0.5">
        {ico && (
          <p>
            {icoLabel} {ico}
          </p>
        )}
        {dic && (
          <p>
            {dicLabel} {dic}
          </p>
        )}
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-neutral-500">{label}</span>
      <span className="tabular text-right">{value || "—"}</span>
    </div>
  );
}

function DocRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-neutral-500">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
