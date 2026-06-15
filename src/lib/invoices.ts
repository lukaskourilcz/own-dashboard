import { addDays, format, parseISO } from "date-fns";
import { parseDateOnly } from "@/lib/date-keys";
import type { Invoice, InvoiceStatus } from "@/lib/types";

// Czech VAT rates as of 2024: 21 % základní, 12 % snížená, 0 %.
export const VAT_RATES = [21, 12, 0] as const;

// Common units (měrné jednotky) offered as suggestions on item rows.
export const UNIT_SUGGESTIONS = ["ks", "hod", "den", "měsíc", "kg", "m", "%"] as const;

/** Round to 2 decimals, nudging away from binary float error. */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export type ItemLike = {
  quantity: number;
  unit_price: number;
  vat_rate: number;
};

/** Line total without VAT (množství × cena/MJ). */
export function lineBase(item: Pick<ItemLike, "quantity" | "unit_price">): number {
  return round2(item.quantity * item.unit_price);
}

/** VAT amount for a single line. */
export function lineVat(item: ItemLike): number {
  return round2(lineBase(item) * (item.vat_rate / 100));
}

/** Line total including VAT. */
export function lineTotal(item: ItemLike): number {
  return round2(lineBase(item) + lineVat(item));
}

export type VatRateGroup = {
  rate: number;
  base: number; // základ daně
  vat: number; // daň
  total: number; // s daní
};

/** Group lines by VAT rate (rekapitulace DPH), highest rate first. */
export function vatBreakdown(items: ItemLike[]): VatRateGroup[] {
  const map = new Map<number, VatRateGroup>();
  for (const it of items) {
    const g = map.get(it.vat_rate) ?? { rate: it.vat_rate, base: 0, vat: 0, total: 0 };
    g.base = round2(g.base + lineBase(it));
    g.vat = round2(g.vat + lineVat(it));
    g.total = round2(g.base + g.vat);
    map.set(it.vat_rate, g);
  }
  return [...map.values()].sort((a, b) => b.rate - a.rate);
}

export type InvoiceTotals = {
  subtotal: number; // základ (bez DPH)
  vatTotal: number; // DPH celkem
  rawTotal: number; // subtotal + vatTotal, před zaokrouhlením
  total: number; // k úhradě (po zaokrouhlení)
  rounding: number; // total − rawTotal
  breakdown: VatRateGroup[];
};

/**
 * Whole-invoice totals. When `roundTotal` is on and the currency is CZK, the
 * grand total is rounded to whole crowns (a Czech convention) and the rounding
 * delta is reported separately so it can show as a "Zaokrouhlení" line.
 */
export function computeTotals(
  items: ItemLike[],
  opts: { roundTotal?: boolean; currency?: string } = {},
): InvoiceTotals {
  const subtotal = round2(items.reduce((s, it) => s + lineBase(it), 0));
  const vatTotal = round2(items.reduce((s, it) => s + lineVat(it), 0));
  const rawTotal = round2(subtotal + vatTotal);
  const shouldRound = (opts.roundTotal ?? false) && (opts.currency ?? "CZK") === "CZK";
  const total = shouldRound ? Math.round(rawTotal) : rawTotal;
  const rounding = round2(total - rawTotal);
  return { subtotal, vatTotal, rawTotal, total, rounding, breakdown: vatBreakdown(items) };
}

/** Strip everything but digits (e.g. to derive a variable symbol). */
export function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/**
 * Suggest the next invoice number as `<year><3-digit sequence>`
 * (e.g. 2026001, 2026002). Scans existing numbers that start with the current
 * year and increments the highest trailing sequence.
 */
export function suggestInvoiceNumber(
  existing: { number: string }[],
  ref: Date = new Date(),
): string {
  const prefix = String(ref.getFullYear());
  let max = 0;
  for (const inv of existing) {
    if (!inv.number.startsWith(prefix)) continue;
    const seq = Number(inv.number.slice(prefix.length));
    if (Number.isFinite(seq) && seq > max) max = seq;
  }
  return `${prefix}${String(max + 1).padStart(3, "0")}`;
}

/** Variable symbol defaults to the digits of the invoice number (max 10). */
export function defaultVariableSymbol(invoiceNumber: string): string {
  return digitsOnly(invoiceNumber).slice(0, 10);
}

/** Add days to a `yyyy-MM-dd` key, returning the same format. */
export function addDaysKey(key: string, days: number): string {
  return format(addDays(parseISO(key), days), "yyyy-MM-dd");
}

/** An issued invoice is overdue once its due date has passed. */
export function isOverdue(
  inv: Pick<Invoice, "status" | "due_date">,
  ref: Date = new Date(),
): boolean {
  if (inv.status !== "issued") return false;
  const today = new Date(ref);
  today.setHours(0, 0, 0, 0);
  return parseDateOnly(inv.due_date).getTime() < today.getTime();
}

/** Display status: like `status`, but surfaces "overdue" for late issued ones. */
export function effectiveStatus(
  inv: Pick<Invoice, "status" | "due_date">,
  ref: Date = new Date(),
): InvoiceStatus | "overdue" {
  return isOverdue(inv, ref) ? "overdue" : inv.status;
}

// ---------------------------------------------------------------------------
// Bank account → IBAN, and the Czech "QR Platba" SPAYD payment string.
// ---------------------------------------------------------------------------

function mod97(numeric: string): number {
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder;
}

function ibanCheckDigits(countryCode: string, bban: string): string {
  // Move country code + "00" to the end, turn letters into numbers, mod 97.
  const rearranged = `${bban}${countryCode}00`;
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  return String(98 - mod97(numeric)).padStart(2, "0");
}

/** Normalise an IBAN: strip spaces, upper-case. */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, "").toUpperCase();
}

/**
 * Convert a Czech domestic account number ("[prefix-]number/bank") to IBAN.
 * Returns null if the input doesn't look like a CZ account number.
 * Example: "19-2000145399/0800" → "CZ6508000000192000145399".
 */
export function czAccountToIban(account: string): string | null {
  const cleaned = account.replace(/\s+/g, "");
  const m = cleaned.match(/^(?:(\d{1,6})-)?(\d{1,10})\/(\d{4})$/);
  if (!m) return null;
  const prefix = (m[1] ?? "").padStart(6, "0");
  const number = m[2].padStart(10, "0");
  const bankCode = m[3];
  const bban = `${bankCode}${prefix}${number}`;
  return `CZ${ibanCheckDigits("CZ", bban)}${bban}`;
}

/** Best-effort IBAN for payment QR: explicit IBAN, else derived from account. */
export function resolveIban(
  source: { iban: string | null; bank_account: string | null },
): string | null {
  if (source.iban && source.iban.trim()) return normalizeIban(source.iban);
  if (source.bank_account) return czAccountToIban(source.bank_account);
  return null;
}

function spaydMessage(msg: string | null | undefined): string {
  // "*" is the SPAYD field delimiter, so it can't appear inside a value.
  return (msg ?? "").replace(/\*/g, " ").trim().slice(0, 60);
}

export type SpaydInput = {
  iban: string;
  amount: number;
  currency?: string;
  variableSymbol?: string | null;
  constantSymbol?: string | null;
  message?: string | null;
  dueDate?: string | null; // yyyy-MM-dd
};

/**
 * Build a SPAYD (Short Payment Descriptor) string — the payload behind the
 * Czech "QR Platba". Rendered as a QR it lets the payer fill a transfer by
 * scanning. See https://qr-platba.cz / the SPAYD 1.0 spec.
 */
export function buildSpayd(input: SpaydInput): string {
  const fields = ["SPD", "1.0", `ACC:${normalizeIban(input.iban)}`];
  fields.push(`AM:${input.amount.toFixed(2)}`);
  fields.push(`CC:${(input.currency ?? "CZK").toUpperCase()}`);
  const vs = digitsOnly(input.variableSymbol ?? "").slice(0, 10);
  if (vs) fields.push(`X-VS:${vs}`);
  const ks = digitsOnly(input.constantSymbol ?? "").slice(0, 10);
  if (ks) fields.push(`X-KS:${ks}`);
  if (input.dueDate) fields.push(`DT:${input.dueDate.replace(/-/g, "")}`);
  const msg = spaydMessage(input.message);
  if (msg) fields.push(`MSG:${msg}`);
  return fields.join("*");
}
