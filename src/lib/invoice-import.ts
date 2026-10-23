import type { ParsedInvoice } from "@/lib/invoice-parser";
import { lineVat, round2, VAT_RATES } from "@/lib/invoices";

/** Only prefill a VAT line when the source supports its rate and amount.
 * A gross total alone is not a tax base; mixed rates cannot be collapsed to
 * the nearest rate without changing the document. Leave uncertain prices blank.
 */
export function importedInvoiceLine(source: ParsedInvoice | undefined, isVatPayer: boolean) {
  const fallback = { unitPrice: undefined as number | undefined, vatRate: isVatPayer ? 21 : 0, roundTotal: false };
  if (!source) return fallback;
  if (!isVatPayer) return { ...fallback, unitPrice: source.total };
  if (source.vatBase == null || source.vatTotal == null) return fallback;
  const { vatBase, vatTotal, total } = source;
  if (![vatBase, vatTotal, ...(total == null ? [] : [total])].every(Number.isFinite)) return fallback;
  const vatRate = VAT_RATES.find(rate => Math.abs(lineVat({ quantity: 1, unit_price: vatBase, vat_rate: rate }) - vatTotal) < 0.005);
  if (vatRate == null) return fallback;
  const raw = round2(vatBase + vatTotal);
  const exact = total == null || Math.abs(raw - total) < 0.005;
  const rounded = source.currency === "CZK" && total != null && Math.abs(Math.round(raw) - total) < 0.005;
  if (!exact && !rounded) return fallback;
  return { unitPrice: vatBase, vatRate, roundTotal: !exact && rounded };
}
