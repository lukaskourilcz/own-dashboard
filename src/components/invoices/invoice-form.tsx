"use client";

import { useState } from "react";
import {
  ArrowLeft,
  Building2,
  FileText,
  Plus,
  Save,
  Trash2,
  User,
} from "lucide-react";
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
import type { ParsedInvoice } from "@/lib/invoice-parser";
import type {
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  PaymentMethod,
  Updater,
} from "@/lib/types";

export type FormMode = "create" | "edit" | "duplicate" | "import";
export type InvoiceSource = { invoice: Invoice; items: InvoiceItem[] };

// Module-level counter for keys of items added at runtime — avoids
// Date.now()/crypto in the render path (React 19 no-impure-calls).
let itemKeyCounter = 0;
const nextKey = () => `it-${++itemKeyCounter}`;

type FormItem = {
  key: string;
  id: string | null; // existing DB row (edit), or null for new rows
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  vat_rate: number;
};

type Buyer = {
  buyer_name: string;
  buyer_address: string;
  buyer_city: string;
  buyer_zip: string;
  buyer_country: string;
  buyer_ico: string;
  buyer_dic: string;
};

type SupplierSnapshot = {
  supplier_name: string;
  supplier_address: string | null;
  supplier_city: string | null;
  supplier_zip: string | null;
  supplier_country: string;
  supplier_ico: string | null;
  supplier_dic: string | null;
  supplier_is_vat_payer: boolean;
  bank_account: string | null;
  iban: string | null;
  footer_note: string | null;
};

type Initial = {
  isVatPayer: boolean;
  number: string;
  variableSymbol: string;
  constantSymbol: string;
  issueDate: string;
  dueDate: string;
  taxDate: string;
  paymentMethod: PaymentMethod;
  currency: string;
  roundTotal: boolean;
  note: string;
  buyer: Buyer;
  items: FormItem[];
  // For edit: the invoice's own (already-issued) supplier block, preserved.
  // For create/duplicate: null — the snapshot is taken from settings at save.
  supplierSnapshot: SupplierSnapshot | null;
};

const PAYMENT_METHODS: PaymentMethod[] = ["bank", "cash", "card"];

/** Snap a parsed VAT ratio (vat/base) to the closest supported rate. */
function snapVatRate(ratio: number): number {
  const pct = ratio * 100;
  return VAT_RATES.reduce<number>((best, r) =>
    Math.abs(r - pct) < Math.abs(best - pct) ? r : best,
  VAT_RATES[0]);
}

function emptyBuyer(): Buyer {
  return {
    buyer_name: "",
    buyer_address: "",
    buyer_city: "",
    buyer_zip: "",
    buyer_country: "Česká republika",
    buyer_ico: "",
    buyer_dic: "",
  };
}

function buyerFrom(inv: Invoice): Buyer {
  return {
    buyer_name: inv.buyer_name,
    buyer_address: inv.buyer_address ?? "",
    buyer_city: inv.buyer_city ?? "",
    buyer_zip: inv.buyer_zip ?? "",
    buyer_country: inv.buyer_country,
    buyer_ico: inv.buyer_ico ?? "",
    buyer_dic: inv.buyer_dic ?? "",
  };
}

function settingsSnapshot(s: InvoiceSettings | null): SupplierSnapshot {
  return {
    supplier_name: s?.supplier_name ?? "",
    supplier_address: s?.supplier_address ?? null,
    supplier_city: s?.supplier_city ?? null,
    supplier_zip: s?.supplier_zip ?? null,
    supplier_country: s?.supplier_country ?? "Česká republika",
    supplier_ico: s?.supplier_ico ?? null,
    supplier_dic: s?.supplier_dic ?? null,
    supplier_is_vat_payer: s?.is_vat_payer ?? false,
    bank_account: s?.bank_account ?? null,
    iban: s?.iban ?? null,
    footer_note: s?.footer_note ?? null,
  };
}

function invoiceSnapshot(inv: Invoice): SupplierSnapshot {
  return {
    supplier_name: inv.supplier_name,
    supplier_address: inv.supplier_address,
    supplier_city: inv.supplier_city,
    supplier_zip: inv.supplier_zip,
    supplier_country: inv.supplier_country,
    supplier_ico: inv.supplier_ico,
    supplier_dic: inv.supplier_dic,
    supplier_is_vat_payer: inv.supplier_is_vat_payer,
    bank_account: inv.bank_account,
    iban: inv.iban,
    footer_note: inv.footer_note,
  };
}

function toFormItems(items: InvoiceItem[], keepId: boolean): FormItem[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((it, i) => ({
      key: `it-init-${i}`,
      id: keepId ? it.id : null,
      description: it.description,
      quantity: String(Number(it.quantity)),
      unit: it.unit ?? "",
      unit_price: String(Number(it.unit_price)),
      vat_rate: Number(it.vat_rate),
    }));
}

function emptyItem(isVatPayer: boolean, key: string): FormItem {
  return {
    key,
    id: null,
    description: "",
    quantity: "1",
    unit: "ks",
    unit_price: "",
    vat_rate: isVatPayer ? 21 : 0,
  };
}

function buildInitial(
  mode: FormMode,
  source: InvoiceSource | undefined,
  settings: InvoiceSettings | null,
  existingInvoices: Invoice[],
  prefill: ParsedInvoice | undefined,
  importedItemLabel: string,
): Initial {
  if (mode === "edit" && source) {
    const inv = source.invoice;
    return {
      isVatPayer: inv.supplier_is_vat_payer,
      number: inv.number,
      variableSymbol: inv.variable_symbol ?? "",
      constantSymbol: inv.constant_symbol ?? "",
      issueDate: inv.issue_date,
      dueDate: inv.due_date,
      taxDate: inv.taxable_supply_date ?? "",
      paymentMethod: inv.payment_method,
      currency: inv.currency,
      roundTotal: inv.round_total,
      note: inv.note ?? "",
      buyer: buyerFrom(inv),
      items: toFormItems(source.items, true),
      supplierSnapshot: invoiceSnapshot(inv),
    };
  }

  if (mode === "import") {
    const isVatPayer = settings?.is_vat_payer ?? false;
    const number =
      prefill?.number?.trim() || suggestInvoiceNumber(existingInvoices);
    let unitPrice = prefill?.total;
    let vatRate = isVatPayer ? 21 : 0;
    if (isVatPayer && prefill?.vatBase) {
      unitPrice = prefill.vatBase;
      if (prefill.vatTotal) {
        vatRate = snapVatRate(prefill.vatTotal / prefill.vatBase);
      }
    }
    return {
      isVatPayer,
      number,
      variableSymbol:
        prefill?.variableSymbol?.trim() || defaultVariableSymbol(number),
      constantSymbol: "",
      issueDate: prefill?.issueDate || todayKey(),
      dueDate:
        prefill?.dueDate ||
        addDaysKey(todayKey(), settings?.default_due_days ?? 14),
      taxDate: (isVatPayer && prefill?.taxableSupplyDate) || "",
      paymentMethod: "bank",
      currency: prefill?.currency || settings?.default_currency || "CZK",
      roundTotal: true,
      note: "",
      buyer: {
        buyer_name: prefill?.buyer?.name ?? "",
        buyer_address: "",
        buyer_city: "",
        buyer_zip: "",
        buyer_country: "Česká republika",
        buyer_ico: prefill?.buyer?.ico ?? "",
        buyer_dic: prefill?.buyer?.dic ?? "",
      },
      items: [
        {
          key: "it-init-0",
          id: null,
          description: importedItemLabel,
          quantity: "1",
          unit: "ks",
          unit_price: unitPrice != null ? String(unitPrice) : "",
          vat_rate: vatRate,
        },
      ],
      supplierSnapshot: null,
    };
  }

  const isVatPayer = settings?.is_vat_payer ?? false;
  const number = suggestInvoiceNumber(existingInvoices);
  const dueDate = addDaysKey(todayKey(), settings?.default_due_days ?? 14);

  if (mode === "duplicate" && source) {
    const inv = source.invoice;
    return {
      isVatPayer,
      number,
      variableSymbol: defaultVariableSymbol(number),
      constantSymbol: inv.constant_symbol ?? "",
      issueDate: todayKey(),
      dueDate,
      taxDate: "",
      paymentMethod: inv.payment_method,
      currency: inv.currency,
      roundTotal: inv.round_total,
      note: inv.note ?? "",
      buyer: buyerFrom(inv),
      items: toFormItems(source.items, false),
      supplierSnapshot: null,
    };
  }

  return {
    isVatPayer,
    number,
    variableSymbol: defaultVariableSymbol(number),
    constantSymbol: "",
    issueDate: todayKey(),
    dueDate,
    taxDate: "",
    paymentMethod: "bank",
    currency: settings?.default_currency ?? "CZK",
    roundTotal: true,
    note: "",
    buyer: emptyBuyer(),
    items: [emptyItem(isVatPayer, "it-init-0")],
    supplierSnapshot: null,
  };
}

export function InvoiceForm({
  mode,
  source,
  prefill,
  settings,
  userId,
  existingInvoices,
  setInvoices,
  setItems,
  onCancel,
  onDone,
  onEditSupplier,
}: {
  mode: FormMode;
  source?: InvoiceSource;
  prefill?: ParsedInvoice;
  settings: InvoiceSettings | null;
  userId: string;
  existingInvoices: Invoice[];
  setInvoices: Updater<Invoice[]>;
  setItems: Updater<InvoiceItem[]>;
  onCancel: () => void;
  onDone: (id: string) => void;
  onEditSupplier: () => void;
}) {
  const supabase = createClient();
  const toast = useToast();
  const t = useDict();

  // Compute the initial form shape exactly once (lazy state init).
  const [init] = useState<Initial>(() =>
    buildInitial(
      mode,
      source,
      settings,
      existingInvoices,
      prefill,
      t.invoices.importedItem,
    ),
  );
  const isVatPayer = init.isVatPayer;

  const [number, setNumber] = useState(init.number);
  const [variableSymbol, setVariableSymbol] = useState(init.variableSymbol);
  const [constantSymbol, setConstantSymbol] = useState(init.constantSymbol);
  const [issueDate, setIssueDate] = useState(init.issueDate);
  const [dueDate, setDueDate] = useState(init.dueDate);
  const [taxDate, setTaxDate] = useState(init.taxDate);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(
    init.paymentMethod,
  );
  const [currency, setCurrency] = useState(init.currency);
  const [roundTotal, setRoundTotal] = useState(init.roundTotal);
  const [note, setNote] = useState(init.note);
  const [buyer, setBuyer] = useState<Buyer>(init.buyer);
  const [items, setFormItems] = useState<FormItem[]>(init.items);
  const [saving, setSaving] = useState(false);

  const supplier = init.supplierSnapshot ?? settingsSnapshot(settings);
  const hasSupplier = Boolean(supplier.supplier_name.trim());

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
    setFormItems((prev) => [...prev, emptyItem(isVatPayer, nextKey())]);
  }

  function removeItem(key: string) {
    setFormItems((prev) =>
      prev.length > 1 ? prev.filter((it) => it.key !== key) : prev,
    );
  }

  async function submit(intent: "draft" | "issued" | "keep") {
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

    const buyerFields = {
      buyer_name: buyer.buyer_name.trim(),
      buyer_address: buyer.buyer_address.trim() || null,
      buyer_city: buyer.buyer_city.trim() || null,
      buyer_zip: buyer.buyer_zip.trim() || null,
      buyer_country: buyer.buyer_country.trim() || "Česká republika",
      buyer_ico: buyer.buyer_ico.trim() || null,
      buyer_dic: buyer.buyer_dic.trim() || null,
    };
    const detailFields = {
      number: number.trim(),
      variable_symbol: variableSymbol.trim() || null,
      constant_symbol: constantSymbol.trim() || null,
      issue_date: issueDate,
      due_date: dueDate,
      taxable_supply_date: isVatPayer ? taxDate || null : null,
      payment_method: paymentMethod,
      currency,
      round_total: roundTotal,
      note: note.trim() || null,
    };
    const itemRows = (invoiceId: string) =>
      kept.map((it, i) => ({
        invoice_id: invoiceId,
        user_id: userId,
        description: it.description.trim(),
        quantity: Number(it.quantity) || 1,
        unit: it.unit.trim() || null,
        unit_price: Number(it.unit_price) || 0,
        vat_rate: isVatPayer ? Number(it.vat_rate) || 0 : 0,
        position: i,
      }));

    // ── Edit: update header, then replace the line items ──────────────────
    if (mode === "edit" && source) {
      const { data: inv, error } = await supabase
        .from("invoices")
        .update({ ...detailFields, ...buyerFields, updated_at: new Date().toISOString() })
        .eq("id", source.invoice.id)
        .select()
        .single();
      if (error || !inv) {
        setSaving(false);
        if (error?.code === "23505") toast.err(t.invoices.numberTaken);
        else toast.err(error?.message ?? t.invoices.errorToast);
        return;
      }
      await supabase
        .from("invoice_items")
        .delete()
        .eq("invoice_id", source.invoice.id);
      const { data: its, error: itErr } = await supabase
        .from("invoice_items")
        .insert(itemRows(source.invoice.id))
        .select();
      if (itErr || !its) {
        setSaving(false);
        toast.err(itErr?.message ?? t.invoices.errorToast);
        return;
      }
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? inv : i)));
      setItems((prev) => [
        ...its,
        ...prev.filter((i) => i.invoice_id !== inv.id),
      ]);
      setSaving(false);
      toast.ok(t.invoices.updatedToast(inv.number));
      onDone(inv.id);
      return;
    }

    // ── Create / duplicate: insert a brand-new invoice ────────────────────
    const status = intent === "draft" ? "draft" : "issued";
    const snap = settingsSnapshot(settings);
    const { data: inv, error } = await supabase
      .from("invoices")
      .insert({
        user_id: userId,
        ...detailFields,
        ...buyerFields,
        status,
        supplier_name: snap.supplier_name,
        supplier_address: snap.supplier_address,
        supplier_city: snap.supplier_city,
        supplier_zip: snap.supplier_zip,
        supplier_country: snap.supplier_country,
        supplier_ico: snap.supplier_ico,
        supplier_dic: snap.supplier_dic,
        supplier_is_vat_payer: isVatPayer,
        bank_account: snap.bank_account,
        iban: snap.iban,
        footer_note: snap.footer_note,
      })
      .select()
      .single();
    if (error || !inv) {
      setSaving(false);
      if (error?.code === "23505") toast.err(t.invoices.numberTaken);
      else toast.err(error?.message ?? t.invoices.errorToast);
      return;
    }
    const { data: its, error: itErr } = await supabase
      .from("invoice_items")
      .insert(itemRows(inv.id))
      .select();
    if (itErr || !its) {
      await supabase.from("invoices").delete().eq("id", inv.id);
      setSaving(false);
      toast.err(itErr?.message ?? t.invoices.errorToast);
      return;
    }
    setInvoices((prev) => [inv, ...prev]);
    setItems((prev) => [...its, ...prev]);
    setSaving(false);
    toast.ok(t.invoices.createdToast(inv.number));
    onDone(inv.id);
  }

  return (
    <div>
      <PageHeader
        title={
          mode === "edit"
            ? t.invoices.formEditTitle
            : mode === "import"
              ? t.invoices.formImportTitle
              : t.invoices.formNewTitle
        }
        action={
          <Button size="sm" variant="outline" onClick={onCancel}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t.invoices.back}
          </Button>
        }
      />

      {mode === "import" && (
        <div className="mb-4 rounded-md border border-border bg-accent px-4 py-2.5 text-sm text-foreground-muted">
          {t.invoices.importedHint}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Supplier (read-only) */}
        <Card>
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> {t.invoices.sectionSupplier}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasSupplier ? (
              <div className="text-sm">
                <p className="font-medium">{supplier.supplier_name}</p>
                {supplier.supplier_address && (
                  <p className="text-foreground-muted">
                    {supplier.supplier_address}
                  </p>
                )}
                <p className="text-foreground-muted">
                  {[supplier.supplier_zip, supplier.supplier_city]
                    .filter(Boolean)
                    .join(" ")}
                </p>
                <p className="text-foreground-subtle text-xs mt-1 tabular">
                  {supplier.supplier_ico
                    ? `${t.invoices.icoLabel} ${supplier.supplier_ico}`
                    : ""}
                  {supplier.supplier_dic
                    ? `  ${t.invoices.dicLabel} ${supplier.supplier_dic}`
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
                  <Building2 className="h-3.5 w-3.5" /> {t.invoices.editSupplier}
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
                        <Label className="block">
                          {t.invoices.itemLineTotal}
                        </Label>
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
            <Button type="button" variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-3.5 w-3.5" /> {t.invoices.addItem}
            </Button>
          </CardContent>
        </Card>

        {/* Note */}
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

        {/* Summary */}
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
          {mode === "edit" ? (
            <Button onClick={() => submit("keep")} disabled={saving}>
              <Save className="h-3.5 w-3.5" /> {t.invoices.saveChanges}
            </Button>
          ) : (
            <>
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
            </>
          )}
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
