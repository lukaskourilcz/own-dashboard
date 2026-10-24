"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { SimpleSelect } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toast";
import { createClient } from "@/lib/supabase/client";
import { qk } from "@/lib/queries/keys";
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
import { vatNameMismatch, vatStatusOf } from "@/lib/tax-registry";
import { StatusBadge } from "@/components/ui/status-badge";
import { useDict } from "@/lib/i18n";
import type { ParsedInvoice } from "@/lib/invoice-parser";
import { importedInvoiceLine } from "@/lib/invoice-import";
import type {
  Invoice,
  InvoiceItem,
  InvoiceSettings,
  Organization,
  PaymentMethod,
  Project,
  Updater,
} from "@/lib/types";

export type FormMode = "create" | "edit" | "duplicate" | "import";
export type InvoiceSource = { invoice: Invoice; items: InvoiceItem[] };

type SubmissionErrorCode = "numberTaken" | "saveConflict" | "saveUnconfirmed" | "buyerNameRequired" | "numberRequired" | "itemRequired" | "invalidAmount";
class InvoiceSaveError extends Error {
  constructor(readonly code: SubmissionErrorCode) { super(code); }
}

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
  organizationId: string;
  projectId: string;
  buyer: Buyer;
  items: FormItem[];
  // For edit: the invoice's own (already-issued) supplier block, preserved.
  // For create/duplicate: null — the snapshot is taken from settings at save.
  supplierSnapshot: SupplierSnapshot | null;
};

const PAYMENT_METHODS: PaymentMethod[] = ["bank", "cash", "card"];

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
      organizationId: inv.organization_id ?? "",
      projectId: inv.project_id ?? "",
      buyer: buyerFrom(inv),
      items: toFormItems(source.items, true),
      supplierSnapshot: invoiceSnapshot(inv),
    };
  }

  if (mode === "import") {
    const isVatPayer = settings?.is_vat_payer ?? false;
    const number =
      prefill?.number?.trim() || suggestInvoiceNumber(existingInvoices);
    const importedLine = importedInvoiceLine(prefill, isVatPayer);
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
      roundTotal: importedLine.roundTotal,
      note: "",
      organizationId: "",
      projectId: "",
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
          unit_price: importedLine.unitPrice != null ? String(importedLine.unitPrice) : "",
          vat_rate: importedLine.vatRate,
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
      organizationId: inv.organization_id ?? "",
      projectId: inv.project_id ?? "",
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
    organizationId: "",
    projectId: "",
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
  existingInvoices,
  setInvoices,
  setItems,
  organizations,
  projects,
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
  organizations: Organization[];
  projects: Project[];
  onCancel: () => void;
  onDone: (id: string) => void;
  onEditSupplier: () => void;
}) {
  const formId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const submissionErrorRef = useRef<HTMLParagraphElement>(null);
  const submissionErrorId = useId();
  const submitting = useRef(false);
  const [validationError, setValidationError] = useState<SubmissionErrorCode | null>(null);
  const requestId = useRef<string | null>(null);
  const [editSnapshot] = useState(() => mode === "edit" && source ? {
    id: source.invoice.id,
    updatedAt: source.invoice.updated_at,
    itemIds: source.items.map((item) => item.id),
  } : null);
  const supabase = createClient();
  const qc = useQueryClient();
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
  const isVatPayer = init.supplierSnapshot?.supplier_is_vat_payer ?? settings?.is_vat_payer ?? false;

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
  const [organizationId, setOrganizationId] = useState(init.organizationId);
  const [projectId, setProjectId] = useState(init.projectId);
  const [buyer, setBuyer] = useState<Buyer>(init.buyer);
  const [items, setFormItems] = useState<FormItem[]>(init.items);

  function selectOrganization(id: string) {
    setOrganizationId(id);
    const organization = organizations.find((item) => item.id === id);
    if (!organization) return;
    setBuyer({
      buyer_name: organization.name,
      buyer_address: organization.address ?? "",
      buyer_city: organization.city ?? "",
      buyer_zip: organization.zip ?? "",
      buyer_country: organization.country ?? "Česká republika",
      buyer_ico: organization.company_id ?? "",
      buyer_dic: organization.vat_id ?? "",
    });
  }

  const supplier = init.supplierSnapshot ?? settingsSnapshot(settings);
  const hasSupplier = Boolean(supplier.supplier_name.trim());

  // Read-only: the linked organization's stored VIES verdict, shown beside the
  // buyer's VAT number so the state of the check is known before the invoice is
  // issued. Verifying happens in Clients; nothing here changes VAT rates.
  const buyerOrganization = organizations.find((item) => item.id === organizationId) ?? null;

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

  // The database commits the header and lines together, retaining this request
  // identity after a failed or ambiguous response so a retry cannot duplicate it.
  const saveMutation = useMutation({
    mutationFn: async ({ header, lines }: {
      header: Record<string, unknown>;
      lines: Array<Record<string, unknown>>;
    }) => {
      requestId.current ??= crypto.randomUUID();
      const editing = editSnapshot;
      const { data, error } = await supabase.rpc("save_invoice_document", {
        p_id: editing ? editing.id : requestId.current,
        p_creating: !editing,
        p_header: header,
        p_items: lines,
        p_expected_updated_at: editing ? editing.updatedAt : null,
        p_expected_item_ids: editing ? editing.itemIds : null,
      });
      if (error) throw new InvoiceSaveError(error.code === "23505" ? "numberTaken"
        : error.code === "40001" || error.code === "P0002" ? "saveConflict"
        : "saveUnconfirmed");
      const result = data as { invoice: Invoice; items: InvoiceItem[] } | null;
      if (!result?.invoice?.id || !Array.isArray(result.items) || result.items.length !== lines.length) {
        throw new InvoiceSaveError("saveUnconfirmed");
      }
      return result;
    },
    onSuccess: ({ invoice, items: savedItems }) => {
      setInvoices((prev) => [invoice, ...prev.filter((item) => item.id !== invoice.id)]);
      setItems((prev) => [...savedItems, ...prev.filter((item) => item.invoice_id !== invoice.id)]);
      void qc.invalidateQueries({ queryKey: qk.invoices });
      void qc.invalidateQueries({ queryKey: qk.invoiceItems });
      toast.ok(mode === "edit" ? t.invoices.updatedToast(invoice.number) : t.invoices.createdToast(invoice.number));
      onDone(invoice.id);
    },
    onError: () => {
      void qc.invalidateQueries({ queryKey: qk.invoices });
      void qc.invalidateQueries({ queryKey: qk.invoiceItems });
    },
    onSettled: () => { submitting.current = false; },
  });
  const saving = saveMutation.isPending;
  const submissionError = validationError ?? (saveMutation.isError
    ? saveMutation.error instanceof InvoiceSaveError ? saveMutation.error.code : "saveUnconfirmed"
    : null);
  useEffect(() => {
    if (submissionError) submissionErrorRef.current?.focus();
  }, [submissionError, saveMutation.isError]);

  function submit(intent: "draft" | "issued" | "keep") {
    if (submitting.current || saving) return;
    setValidationError(null);
    saveMutation.reset();
    if (!formRef.current?.reportValidity()) return;
    const kept = items.filter((it) => it.description.trim() !== "");
    if (!buyer.buyer_name.trim()) {
      setValidationError("buyerNameRequired");
      return;
    }
    if (!number.trim()) {
      setValidationError("numberRequired");
      return;
    }
    if (kept.length === 0) {
      setValidationError("itemRequired");
      return;
    }

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
      organization_id: organizationId || null,
      project_id: projectId || null,
    };
    const lines = kept.map((it) => ({
      description: it.description.trim(),
      quantity: Number(it.quantity),
      unit: it.unit.trim() || null,
      unit_price: Number(it.unit_price),
      vat_rate: isVatPayer ? Number(it.vat_rate) : 0,
    }));
    if (lines.some((it) => !Number.isFinite(it.quantity) || !Number.isFinite(it.unit_price)
      || !Number.isFinite(it.vat_rate))) {
      setValidationError("invalidAmount");
      return;
    }
    submitting.current = true;
    if (mode === "edit" && source) {
      saveMutation.mutate({ header: { ...detailFields, ...buyerFields }, lines });
      return;
    }

    // ── Create / duplicate: insert a brand-new invoice ────────────────────
    const status = intent === "draft" ? "draft" : "issued";
    const snap = settingsSnapshot(settings);
    saveMutation.mutate({
      header: {
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
      },
      lines,
    });
  }

  return (
    <form ref={formRef} onSubmit={(event) => { event.preventDefault(); submit(mode === "edit" ? "keep" : "draft"); }}>
      <PageHeader
        title={
          mode === "edit"
            ? t.invoices.formEditTitle
            : mode === "import"
              ? t.invoices.formImportTitle
              : t.invoices.formNewTitle
        }
        action={
          <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={saving}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t.invoices.back}
          </Button>
        }
      />

      {mode === "import" && (
        <div className="mb-4 rounded-md border border-border bg-accent px-4 py-2.5 text-sm text-foreground-muted">
          {t.invoices.importedHint}
        </div>
      )}

      <fieldset disabled={saving} className="grid min-w-0 gap-4 lg:grid-cols-2">
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
                <Button type="button" size="sm" variant="outline" onClick={onEditSupplier}>
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
              <Label htmlFor="b-organization">{t.invoices.linkedOrganization}</Label>
              <SimpleSelect
                id="b-organization"
                value={organizationId}
                onValueChange={selectOrganization}
                options={[
                  { value: "", label: t.invoices.noLinkedOrganization },
                  ...organizations.map((organization) => ({ value: organization.id, label: organization.name })),
                ]}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-project">{t.invoices.linkedProject}</Label>
              <SimpleSelect
                id="b-project"
                value={projectId}
                onValueChange={setProjectId}
                options={[
                  { value: "", label: t.invoices.noLinkedProject },
                  ...projects.map((project) => ({ value: project.id, label: project.name })),
                ]}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="b-name">{t.invoices.fieldName}</Label>
              <Input
                id="b-name" required
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
            {buyerOrganization && buyerOrganization.vat_id && (
              <div className="space-y-1.5 rounded-md border border-border bg-surface-inset p-3 sm:col-span-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-foreground-muted">
                    {t.invoices.buyerVatVerification}
                  </span>
                  <StatusBadge value={`vat_${vatStatusOf(buyerOrganization)}`} />
                  {buyerOrganization.vat_verified_at && (
                    <span className="text-xs tabular text-foreground-muted">
                      {buyerOrganization.vat_verified_at.slice(0, 10)}
                    </span>
                  )}
                </div>
                {vatStatusOf(buyerOrganization) === "unchecked" && (
                  <p className="text-xs text-foreground-muted">
                    {t.invoices.buyerVatUnverified}
                  </p>
                )}
                {vatNameMismatch(buyer.buyer_name, buyerOrganization.vat_verified_name) && (
                  <p className="text-xs text-warning">
                    {t.invoices.buyerVatNameMismatch}: {buyerOrganization.vat_verified_name}
                  </p>
                )}
              </div>
            )}
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
                id="i-number" required
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
                id="i-issue" required
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-due">{t.invoices.fieldDueDate}</Label>
              <Input
                id="i-due" required
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
              <SimpleSelect
                id="i-pm"
                value={paymentMethod}
                onValueChange={(v) => setPaymentMethod(v as PaymentMethod)}
                options={PAYMENT_METHODS.map((m) => ({
                  value: m,
                  label: t.invoices.paymentMethod[m],
                }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="i-ccy">{t.invoices.fieldCurrency}</Label>
              <SimpleSelect
                id="i-ccy"
                value={currency}
                onValueChange={setCurrency}
                options={SUPPORTED_CURRENCIES.map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t.invoices.sectionItems}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <datalist id={`${formId}-unit-suggestions`}>
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
                      aria-label={t.invoices.itemDescriptionPlaceholder}
                      placeholder={t.invoices.itemDescriptionPlaceholder}
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="space-y-1 w-20">
                        <Label htmlFor={`${formId}-item-${i}-quantity`}>{t.invoices.itemQuantity}</Label>
                        <Input
                          id={`${formId}-item-${i}-quantity`}
                          type="number"
                          step="0.001"
                          min={0}
                          max="99999999999.999"
                          required={Boolean(it.description.trim())}
                          value={it.quantity}
                          onChange={(e) =>
                            setItemField(it.key, "quantity", e.target.value)
                          }
                          className="h-11 text-xs md:h-8"
                        />
                      </div>
                      <div className="space-y-1 w-16">
                        <Label htmlFor={`${formId}-item-${i}-unit`}>{t.invoices.itemUnit}</Label>
                        <Input
                          id={`${formId}-item-${i}-unit`}
                          list={`${formId}-unit-suggestions`}
                          value={it.unit}
                          onChange={(e) =>
                            setItemField(it.key, "unit", e.target.value)
                          }
                          className="h-11 text-xs md:h-8"
                        />
                      </div>
                      <div className="space-y-1 w-28">
                        <Label htmlFor={`${formId}-item-${i}-unit_price`}>{t.invoices.itemUnitPrice}</Label>
                        <Input
                          id={`${formId}-item-${i}-unit_price`}
                          type="number"
                          step="0.01"
                          min="-999999999999.99"
                          max="999999999999.99"
                          required={Boolean(it.description.trim())}
                          value={it.unit_price}
                          onChange={(e) =>
                            setItemField(it.key, "unit_price", e.target.value)
                          }
                          placeholder="0.00"
                          className="h-11 text-xs md:h-8"
                        />
                      </div>
                      {isVatPayer && (
                        <div className="space-y-1 w-20">
                          <Label htmlFor={`${formId}-item-${i}-vat_rate`}>{t.invoices.itemVat}</Label>
                          <SimpleSelect
                          id={`${formId}-item-${i}-vat_rate`}
                            value={String(it.vat_rate)}
                            onValueChange={(v) =>
                              setItemField(it.key, "vat_rate", Number(v))
                            }
                            className="h-11 text-xs md:h-8"
                            options={VAT_RATES.map((r) => ({
                              value: String(r),
                              label: `${r} %`,
                            }))}
                          />
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
                      type="button"
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
              aria-label={t.invoices.sectionNote}
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
        <div className="lg:col-span-2 flex min-w-0 flex-wrap items-center justify-end gap-3" data-testid="invoice-form-actions">
          {submissionError && <p ref={submissionErrorRef} id={submissionErrorId} role="alert" tabIndex={-1}
            className="focus-ring min-w-0 flex-1 basis-full rounded-sm text-sm text-risk sm:min-w-48 sm:basis-auto">{t.invoices[submissionError]}</p>}
          <div className="flex w-full max-w-full flex-wrap justify-end gap-2 sm:w-auto">
          <Button type="button" variant="outline" className="min-w-max flex-1 sm:flex-none" onClick={onCancel} disabled={saving}>
            {t.invoices.cancel}
          </Button>
          {mode === "edit" ? (
            <Button type="button" className="min-w-max flex-1 sm:flex-none" onClick={() => submit("keep")} disabled={saving} aria-describedby={submissionError ? submissionErrorId : undefined}>
              <Save className="h-3.5 w-3.5" /> {t.invoices.saveChanges}
            </Button>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                className="min-w-max flex-1 sm:flex-none"
                onClick={() => submit("draft")}
                disabled={saving}
                aria-describedby={submissionError ? submissionErrorId : undefined}
              >
                {t.invoices.saveDraft}
              </Button>
              <Button type="button" className="min-w-max flex-1 sm:flex-none" onClick={() => submit("issued")} disabled={saving} aria-describedby={submissionError ? submissionErrorId : undefined}>
                <FileText className="h-3.5 w-3.5" /> {t.invoices.issue}
              </Button>
            </>
          )}
          </div>
        </div>
      </fieldset>
    </form>
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
