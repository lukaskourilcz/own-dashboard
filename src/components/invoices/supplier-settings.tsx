"use client";

import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, Save, Upload, X } from "lucide-react";
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
import { useDict } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { InvoiceSettings } from "@/lib/types";

type Form = {
  supplier_name: string;
  supplier_address: string;
  supplier_city: string;
  supplier_zip: string;
  supplier_country: string;
  supplier_ico: string;
  supplier_dic: string;
  is_vat_payer: boolean;
  bank_account: string;
  iban: string;
  default_due_days: string;
  default_currency: string;
  footer_note: string;
  logo: string;
};

function fromSettings(s: InvoiceSettings | null): Form {
  return {
    supplier_name: s?.supplier_name ?? "",
    supplier_address: s?.supplier_address ?? "",
    supplier_city: s?.supplier_city ?? "",
    supplier_zip: s?.supplier_zip ?? "",
    supplier_country: s?.supplier_country ?? "Česká republika",
    supplier_ico: s?.supplier_ico ?? "",
    supplier_dic: s?.supplier_dic ?? "",
    is_vat_payer: s?.is_vat_payer ?? false,
    bank_account: s?.bank_account ?? "",
    iban: s?.iban ?? "",
    default_due_days: String(s?.default_due_days ?? 14),
    default_currency: s?.default_currency ?? "CZK",
    footer_note: s?.footer_note ?? "",
    logo: s?.logo ?? "",
  };
}

const ACCEPTED_LOGO_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/svg+xml",
];

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = src;
  });
}

/**
 * Turn a picked file into a compact data URL we can store inline. SVGs are
 * kept as-is (vector); raster images are downscaled to ≤ 480 px on the long
 * edge and re-encoded as PNG, so the row stays small and the logo travels
 * embedded in the invoice (print/PDF included).
 */
async function processLogo(file: File): Promise<string> {
  if (file.type === "image/svg+xml") return readAsDataUrl(file);
  const dataUrl = await readAsDataUrl(file);
  const img = await loadImage(dataUrl);
  const max = 480;
  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (Math.max(w, h) > max) {
    const scale = max / Math.max(w, h);
    w = Math.round(w * scale);
    h = Math.round(h * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL("image/png");
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-ring",
        checked ? "bg-primary" : "bg-surface-muted border border-border",
      )}
    >
      <span
        className={cn(
          "inline-block h-4 w-4 transform rounded-full bg-surface shadow-soft transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function SupplierSettings({
  settings,
  userId,
  onSaved,
  onBack,
}: {
  settings: InvoiceSettings | null;
  userId: string;
  onSaved: (s: InvoiceSettings) => void;
  onBack: () => void;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const toast = useToast();
  const t = useDict();
  const [form, setForm] = useState<Form>(() => fromSettings(settings));
  const fileRef = useRef<HTMLInputElement>(null);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    if (!ACCEPTED_LOGO_TYPES.includes(file.type)) {
      toast.err(t.invoices.logoInvalid);
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.err(t.invoices.logoTooLarge);
      return;
    }
    try {
      set("logo", await processLogo(file));
    } catch {
      toast.err(t.invoices.logoInvalid);
    }
  }

  // Settings upsert — a single row that needs the server's canonical copy back,
  // so it's non-optimistic: the cache is updated in onSuccess (via onSaved,
  // which is the panel's setSettings) and then qk.invoiceSettings is invalidated.
  const saveMutation = useMutation({
    mutationFn: async (row: Record<string, unknown>) => {
      const { data, error } = await supabase
        .from("invoice_settings")
        .upsert(row)
        .select()
        .single();
      if (error || !data) {
        throw new Error(error?.message ?? t.invoices.errorToast);
      }
      return data as InvoiceSettings;
    },
    onSuccess: (data) => {
      onSaved(data);
      void qc.invalidateQueries({ queryKey: qk.invoiceSettings });
      toast.ok(t.invoices.savedSettingsToast);
      onBack();
    },
    onError: (error) => toast.err((error as Error).message),
  });

  const saving = saveMutation.isPending;

  function save(e: React.FormEvent) {
    e.preventDefault();
    const row = {
      user_id: userId,
      supplier_name: form.supplier_name.trim(),
      supplier_address: form.supplier_address.trim() || null,
      supplier_city: form.supplier_city.trim() || null,
      supplier_zip: form.supplier_zip.trim() || null,
      supplier_country: form.supplier_country.trim() || "Česká republika",
      supplier_ico: form.supplier_ico.trim() || null,
      supplier_dic: form.supplier_dic.trim() || null,
      is_vat_payer: form.is_vat_payer,
      bank_account: form.bank_account.trim() || null,
      iban: form.iban.trim() || null,
      default_due_days: Math.max(0, Number(form.default_due_days) || 14),
      default_currency: form.default_currency,
      footer_note: form.footer_note.trim() || null,
      logo: form.logo || null,
      updated_at: new Date().toISOString(),
    };
    saveMutation.mutate(row);
  }

  return (
    <div>
      <PageHeader
        title={t.invoices.settingsTitle}
        description={t.invoices.settingsDesc}
        action={
          <Button size="sm" variant="outline" onClick={onBack}>
            <ArrowLeft className="h-3.5 w-3.5" /> {t.invoices.back}
          </Button>
        }
      />

      <form onSubmit={save} className="grid gap-4 lg:grid-cols-2">
        {/* Supplier identity */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="inline-flex items-center gap-1.5">
              <Building2 className="h-3 w-3" /> {t.invoices.sectionSupplier}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>{t.invoices.logoLabel}</Label>
              <div className="flex flex-wrap items-center gap-3">
                {form.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={form.logo}
                    alt=""
                    className="h-12 max-w-[160px] object-contain rounded-md border border-border bg-white p-1"
                  />
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED_LOGO_TYPES.join(",")}
                  className="hidden"
                  onChange={onLogoFile}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-3.5 w-3.5" /> {t.invoices.uploadLogo}
                </Button>
                {form.logo && (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => set("logo", "")}
                  >
                    <X className="h-3.5 w-3.5" /> {t.invoices.removeLogo}
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-foreground-subtle">
                {t.invoices.logoHint}
              </p>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="set-name">{t.invoices.supplierNameLabel}</Label>
              <Input
                id="set-name"
                value={form.supplier_name}
                onChange={(e) => set("supplier_name", e.target.value)}
                placeholder={t.invoices.buyerNamePlaceholder}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="set-address">{t.invoices.fieldAddress}</Label>
              <Input
                id="set-address"
                value={form.supplier_address}
                onChange={(e) => set("supplier_address", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-city">{t.invoices.fieldCity}</Label>
              <Input
                id="set-city"
                value={form.supplier_city}
                onChange={(e) => set("supplier_city", e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="set-zip">{t.invoices.fieldZip}</Label>
                <Input
                  id="set-zip"
                  value={form.supplier_zip}
                  onChange={(e) => set("supplier_zip", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-country">{t.invoices.fieldCountry}</Label>
                <Input
                  id="set-country"
                  value={form.supplier_country}
                  onChange={(e) => set("supplier_country", e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-ico">{t.invoices.fieldIco}</Label>
              <Input
                id="set-ico"
                value={form.supplier_ico}
                onChange={(e) => set("supplier_ico", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-dic">{t.invoices.fieldDic}</Label>
              <Input
                id="set-dic"
                value={form.supplier_dic}
                onChange={(e) => set("supplier_dic", e.target.value)}
                placeholder="CZ…"
              />
            </div>
          </CardContent>
        </Card>

        {/* Payment + defaults */}
        <Card>
          <CardHeader>
            <CardTitle>{t.invoices.bankAccount}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="set-account">{t.invoices.bankAccount}</Label>
              <Input
                id="set-account"
                value={form.bank_account}
                onChange={(e) => set("bank_account", e.target.value)}
                placeholder={t.invoices.bankAccountPlaceholder}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-iban">{t.invoices.iban}</Label>
              <Input
                id="set-iban"
                value={form.iban}
                onChange={(e) => set("iban", e.target.value)}
                placeholder={t.invoices.ibanPlaceholder}
              />
              <p className="text-[11px] text-foreground-subtle">
                {t.invoices.ibanHint}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t.invoices.settings}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {t.invoices.vatPayerToggle}
                </p>
                <p className="text-[11px] text-foreground-subtle">
                  {t.invoices.vatPayerHint}
                </p>
              </div>
              <Switch
                checked={form.is_vat_payer}
                onChange={() => set("is_vat_payer", !form.is_vat_payer)}
                label={t.invoices.vatPayerToggle}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="set-due">{t.invoices.defaultDueDays}</Label>
                <Input
                  id="set-due"
                  type="number"
                  min={0}
                  value={form.default_due_days}
                  onChange={(e) => set("default_due_days", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-ccy">{t.invoices.defaultCurrency}</Label>
                <SimpleSelect
                  id="set-ccy"
                  value={form.default_currency}
                  onValueChange={(v) => set("default_currency", v)}
                  options={SUPPORTED_CURRENCIES.map((c) => ({
                    value: c,
                    label: c,
                  }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-footer">{t.invoices.footerNote}</Label>
              <Textarea
                id="set-footer"
                rows={2}
                value={form.footer_note}
                onChange={(e) => set("footer_note", e.target.value)}
                placeholder={t.invoices.footerNotePlaceholder}
              />
            </div>
          </CardContent>
        </Card>

        <div className="lg:col-span-2 flex justify-end">
          <Button type="submit" disabled={saving}>
            <Save className="h-3.5 w-3.5" /> {t.invoices.saveSettings}
          </Button>
        </div>
      </form>
    </div>
  );
}
