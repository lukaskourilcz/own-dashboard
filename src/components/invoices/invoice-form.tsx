"use client";

import { useState } from "react";
import { ArrowLeft, Building2, FileText, Plus, Trash2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { todayKey } from "@/lib/date-keys";
import {
  addDaysKey,
  computeTotals,
  defaultVariableSymbol,
  lineTotal,
  suggestInvoiceNumber,
  UNIT_SUGGESTIONS,
  VAT_RATES,
} from "@/lib/invoices";
import { cn, formatCurrency } from "@/lib/utils";
import { useDict } from "@/lib/i18n";
import type {
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  PaymentMethod,
  Updater,
} from "@/lib/types";

// Module-level counter for local item keys — avoids Date.now()/crypto in the
// render path (React 19 no-impure-calls), like the streak-log tentative ids.
let itemKeyCounter = 0;
const nextKey = () => `it-${++itemKeyCounter}`;

type FormItem = {
  key: string;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: number;
};

function emptyItem(isVatPayer: boolean): FormItem {
  return {
    key: nextKey(),
    description: "",
    quantity: "1",
    unit: "ks",
    unit_price: "",
    vat_rate: isVatPayer ? 21 : 0,
  };
}

const PAYMENT_METHODS: PaymentMethod[] = ["bank", "cash", "card"];

export function InvoiceForm({
  settings,
  userId,
  existingInvoices,
  setInvoices,
  setItems,
  onCancel,
  onCreated,
  onEditSupplier,
}: {
  settings: InvoiceSettings | null;
  userId: string;
  existingInvoices: Invoice[];
  setInvoices: Updater<Invoice[]>;
  setItems: Updater<InvoiceItem[]>;
  onCancel: () => void;
  onCreated: (id: string) => void;
  onEditSupplier: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const t = useDict();
  const isVatPayer = settings?.is_vat_payer ?? false;

  const [number, setNumber] = useState(() =>
    suggestInvoiceNumber(existingInvoices),
  );
  const [variableSymbol, setVariableSymbol] = useState(() =>
    defaultVariableSymbol(suggestInvoiceNumber(existingInvoices)),
  );
  const [constantSymbol, setConstantSymbol] = useState("");
  const [issueDate, setIssueDate] = useState(() => todayKey());
  const [dueDate, setDueDate] = useState(() =>
    addDaysKey(todayKey(), settings?.default_due_days ?? 14),
  );
  const [taxDate, setTaxDate] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("bank");
  const [currency, setCurrency] = useState(settings?.default_currency ?? "CZK");
  const [roundTotal, setRoundTotal] = useState(true);
  const [note, setNote] = useState("");

  const [buyer, setBuyer] = useState({
    buyer_name: "",
    buyer_address: "",
    buyer_city: "",
    buyer_zip: "",
    buyer_country: "Česká republika",
    buyer_ico: "",
    buyer_dic: "",
  });

  const [items, setFormItems] = useState<FormItem[]>(() => [
    emptyItem(isVatPayer),
  ]);
  const [saving, setSaving] = useState(false);

  const parsed = items.map((it) => ({
    quantity: Number(it.quantity) || 0,
    unit_price: Number(it.unit_price) || 0,
    vat_rate: isVatPayer ? Number(it.vat_rate) || 0 : 0,
  }));
  const totals = computeTotals(parsed, { roundTotal, currency });

  function setItemField<K extends keyof FormItem>(
    key: string,
    field: K,
    value: FormItem[K],
  ) {
    setFormItems((prev) =>
      prev.map((it) => (it.key === key ? { ...it, [field]: value } : it)),
    );
  }

  function addItem() {
    setFormItems((prev) => [...prev, emptyItem(isVatPayer)]);
  }

  function removeItem(key: string) {
    setFormItems((prev) =>
      prev.length > 1 ? prev.filter((it) => it.key !== key) : prev,
    );
  }

  async function submit(status: "draft" | "issued") {
    const kept = items.filter((it) => it.description.trim() !== "");
    if (!buyer.buyer_name.trim()) {
      toast.err(t.invoices.buyerNameRequired);
      return;
    }
    if (!number.trim()) {
      toast.err(t.invoices.numberRequired);
      return;
    }
    if (kept.length === 0) {
      toast.err(t.invoices.itemRequired);
      return;
    }
    setSaving(true);

    const invoiceRow = {
      user_id: userId,
      number: number.trim(),
      variable_symbol: variableSymbol.trim() || null,
      constant_symbol: constantSymbol.trim() || null,
      issue_date: issueDate,
      due_date: dueDate,
      taxable_supply_date: isVatPayer ? taxDate || null : null,
      payment_method: paymentMethod,
      currency,
      status,
      round_total: roundTotal,
      buyer_name: buyer.buyer_name.trim(),
      buyer_address: buyer.buyer_address.trim() || null,
      buyer_city: buyer.buyer_city.trim() || null,
      buyer_zip: buyer.buyer_zip.trim() || null,
      buyer_country: buyer.buyer_country.trim() || "Česká republika",
      buyer_ico: buyer.buyer_ico.trim() || null,
      buyer_dic: buyer.buyer_dic.trim() || null,
      supplier_name: settings?.supplier_name ?? "",
      supplier_address: settings?.supplier_address ?? null,
      supplier_city: settings?.supplier_city ?? null,
      supplier_zip: settings?.supplier_zip ?? null,
      supplier_country: settings?.supplier_country ?? "Česká republika",
      supplier_ico: settings?.supplier_ico ?? null,
      supplier_dic: settings?.supplier_dic ?? null,
      supplier_is_vat_payer: isVatPayer,
      bank_account: settings?.bank_account ?? null,
      iban: settings?.iban ?? null,
      note: note.trim() || null,
      footer_note: settings?.footer_note ?? null,
    };

    const { data: inv, error } = await supabase
      .from("invoices")
      .insert(invoiceRow)
      .select()
      .single();
    if (error || !inv) {
      setSaving(false);
      if (error?.code === "23505") toast.err(t.invoices.numberTaken);
      else toast.err(error?.message ?? t.invoices.errorToast);
      return;
    }

    const itemRows = kept.map((it, i) => ({
      invoice_id: inv.id,
      user_id: userId,
      description: it.description.trim(),
      quantity: Number(it.quantity) || 1,
      unit: it.unit.trim() || null,
      unit_price: Number(it.unit_price) || 0,
      vat_rate: isVatPayer ? Number(it.vat_rate) || 0 : 0,
      position: i,
    }));
    const { data: its, error: itErr } = await supabase
      .from("invoice_items")
      .insert(itemRows)
      .select();
    if (itErr || !its) {
      // Roll back the header so we don't leave an item-less invoice behind.
      await supabase.from("invoices").delete().eq("id", inv.id);
      setSaving(false);
      toast.err(itErr?.message ?? t.invoices.errorToast);
      return;
    }

    setInvoices((prev) => [inv, ...prev]);
    setItems((prev) => [...its, ...prev]);
    setSaving(false);
    toast.ok(t.invoices.createdToast(inv.number));
    onCreated(inv.id);
  }

  const hasSupplier = Boolean(settings?.supplier_name?.trim());

  return (
    <div>
      <PageHeader
        title={t.invoices.formNewTitle}
        action={
          <Button size="sm" variant="outline" onClick={onCancel}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t.invoices.back}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Supplier (read-only, from settings) */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> {t.invoices.sectionSupplier}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasSupplier ? (
              <div className="text-sm">
                <p className="font-medium">{settings?.supplier_name}</p>
                {settings?.supplier_address && (
                  <p className="text-foreground-muted">
                    {settings.supplier_address}
                  </p>
                )}
                <p className="text-foreground-muted">
                  {[settings?.supplier_zip, settings?.supplier_city]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                <p className="text-foreground-subtle text-xs mt-1 tabular">
                  {settings?.supplier_ico
                    ? `${t.invoices.icoLabel} ${settings.supplier_ico}`
                    : ""}
                  {settings?.supplier_dic
                    ? `  ${t.invoices.dicLabel} ${settings.supplier_dic}`
                    : ""}
                </p>
                <button
                  type="button"
                  onClick={onEditSupplier}
                  className="mt-2 text-xs text-foreground-muted underline underline-offset-2 hover:text-foreground"
                >
                  {t.invoices.editSupplier}
                </button>
              </div>
            ) : (
              <div className="text-sm space-y-2">
                <p className="text-foreground-muted">
                  {t.invoices.supplierMissing}
                </p>
                <Button size="sm" variant="outline" onClick={onEditSupplier}>
                  <Building2 className="h-3.5 w-3.5" />{" "}
                  {t.invoices.editSupplier}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Buyer */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <User className="h-3 w-3" /> {t.invoices.sectionBuyer}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-name">{t.invoices.fieldName}</Label>
              <Input
                id="b-name"
                value={buyer.buyer_name}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_name: e.target.value })
                }
                placeholder={t.invoices.buyerNamePlaceholder}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-address">{t.invoices.fieldAddress}</Label>
              <Input
                id="b-address"
                value={buyer.buyer_address}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_address: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-city">{t.invoices.fieldCity}</Label>
              <Input
                id="b-city"
                value={buyer.buyer_city}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_city: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-zip">{t.invoices.fieldZip}</Label>
              <Input
                id="b-zip"
                value={buyer.buyer_zip}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_zip: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-ico">{t.invoices.fieldIco}</Label>
              <Input
                id="b-ico"
                value={buyer.buyer_ico}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_ico: e.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="b-dic">{t.invoices.fieldDic}</Label>
              <Input
                id="b-dic"
                value={buyer.buyer_dic}
                onChange={(e) =>
                  setBuyer({ ...buyer, buyer_dic: e.target.value })
                }
              />
            </div>
          </CardContent>
        </Card>

        {/* Invoice details */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <FileText className="h-3 w-3" /> {t.invoices.sectionDetails}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="i-number">{t.invoices.fieldNumber}</Label>
              <Input
                id="i-number"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-vs">{t.invoices.fieldVs}</Label>
              <Input
                id="i-vs"
                value={variableSymbol}
                onChange={(e) => setVariableSymbol(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-ks">{t.invoices.fieldKs}</Label>
              <Input
                id="i-ks"
                value={constantSymbol}
                onChange={(e) => setConstantSymbol(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-issue">{t.invoices.fieldIssueDate}</Label>
              <Input
                id="i-issue"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-due">{t.invoices.fieldDueDate}</Label>
              <Input
                id="i-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>
            {isVatPayer && (
              <div className="space-y-1.5">
                <Label htmlFor="i-tax">{t.invoices.fieldTaxDate}</Label>
                <Input
                  id="i-tax"
                  type="date"
                  value={taxDate}
                  onChange={(e) => setTaxDate(e.target.value)}
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="i-pm">{t.invoices.fieldPaymentMethod}</Label>
              <Select
                id="i-pm"
                value={paymentMethod}
                onChange={(e) =>
                  setPaymentMethod(e.target.value as PaymentMethod)
                }
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t.invoices.paymentMethod[m]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-ccy">{t.invoices.fieldCurrency}</Label>
              <Select
                id="i-ccy"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {SUPPORTED_CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.invoices.sectionItems}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <datalist id="unit-suggestions">
              {UNIT_SUGGESTIONS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {items.map((it, i) => (
              <div key={it.key} className="rounded-lg border border-border p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-2">
                    <Input
                      value={it.description}
                      onChange={(e) =>
                        setItemField(it.key, "description", e.target.value)
                      }
                      placeholder={t.invoices.itemDescriptionPlaceholder}
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1 w-20">
                        <Label>{t.invoices.itemQuantity}</Label>
                        <Input
                          type="number"
                          step="0.001"
                          min={0}
                          value={it.quantity}
                          onChange={(e) =>
                            setItemField(it.key, "quantity", e.target.value)
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1 w-16">
                        <Label>{t.invoices.itemUnit}</Label>
                        <Input
                          list="unit-suggestions"
                          value={it.unit}
                          onChange={(e) =>
                            setItemField(it.key, "unit", e.target.value)
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="space-y-1 w-28">
                        <Label>{t.invoices.itemUnitPrice}</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={it.unit_price}
                          onChange={(e) =>
                            setItemField(it.key, "unit_price", e.target.value)
                          }
                          placeholder="0.00"
                          className="h-8 text-xs"
                        />
                      </div>
                      {isVatPayer && (
                        <div className="space-y-1 w-20">
                          <Label>{t.invoices.itemVat}</Label>
                          <Select
                            value={String(it.vat_rate)}
                            onChange={(e) =>
                              setItemField(
                                it.key,
                                "vat_rate",
                                Number(e.target.value),
                              )
                            }
                            className="h-8 text-xs"
                          >
                            {VAT_RATES.map((r) => (
                              <option key={r} value={r}>
                                {r} %
                              </option>
                            ))}
                          </Select>
                        </div>
                      )}
                      <div className="ml-auto text-right space-y-1">
                        <Label className="block">{t.invoices.itemLineTotal}</Label>
                        <p className="text-sm font-medium tabular h-8 flex items-center justify-end">
                          {formatCurrency(lineTotal(parsed[i]), currency)}
                        </p>
                      </div>
                    </div>
                  </div>
                  {items.length > 1 && (
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      onClick={() => removeItem(it.key)}
                      aria-label={t.invoices.removeItem}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addItem}
            >
              <Plus className="h-3.5 w-3.5" /> {t.invoices.addItem}
            </Button>
          </CardContent>
        </Card>

        {/* Summary + note */}
        <Card>
          <CardHeader>
            <CardTitle>{t.invoices.sectionNote}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              rows={4}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.invoices.notePlaceholder}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.invoices.sectionSummary}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {isVatPayer ? (
              <>
                <Row
                  label={t.invoices.subtotalLabel}
                  value={formatCurrency(totals.subtotal, currency)}
                />
                <Row
                  label={t.invoices.vatTotalLabel}
                  value={formatCurrency(totals.vatTotal, currency)}
                />
              </>
            ) : (
              <p className="text-xs text-foreground-subtle">
                {t.invoices.nonVatPayerNote}
              </p>
            )}
            {currency === "CZK" && (
              <label className="flex items-center gap-2 text-xs text-foreground-muted py-1">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border-strong"
                  checked={roundTotal}
                  onChange={(e) => setRoundTotal(e.target.checked)}
                />
                {t.invoices.roundTotalToggle}
              </label>
            )}
            {totals.rounding !== 0 && (
              <Row
                label={t.invoices.roundingLabel}
                value={formatCurrency(totals.rounding, currency)}
              />
            )}
            <div className="flex items-center justify-between pt-2 border-t border-border">
              <span className="text-sm font-semibold">
                {t.invoices.totalToPayLabel}
              </span>
              <span className="text-lg font-semibold tabular">
                {formatCurrency(totals.total, currency)}
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="lg:col-span-2 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            {t.invoices.cancel}
          </Button>
          <Button
            variant="outline"
            onClick={() => submit("draft")}
            disabled={saving}
          >
            {t.invoices.saveDraft}
          </Button>
          <Button onClick={() => submit("issued")} disabled={saving}>
            <FileText className="h-3.5 w-3.5" /> {t.invoices.issue}
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className={cn("flex items-center justify-between text-sm")}>
      <span className="text-foreground-muted">{label}</span>
      <span className="tabular">{value}</span>
    </div>
  );
}
