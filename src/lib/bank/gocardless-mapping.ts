/**
 * Pure GoCardless → OwnDashboard mappings, lifted out of `bank-sync-server.ts`
 * when the provider abstraction landed. Kept free of network code and of the
 * `server-only` marker so the status table is unit-testable.
 */
import type { ProviderConsentStatus } from "@/lib/bank/provider";

/** A GoCardless balance entry, structurally identical to the one the HTTP
 *  client returns. Declared here so this module needs no server-only import. */
export type GoCardlessBalance = {
  balanceAmount: { amount: string; currency: string };
  balanceType?: string;
};

/**
 * GoCardless requisition status codes → our connection status.
 *
 * `EX` (expired) and `SU` (suspended) are the 90-day lapse the provider
 * abstraction exists for; everything before `LN` is still pending consent.
 */
export function mapRequisitionStatus(code: string): ProviderConsentStatus {
  if (code === "LN") return "linked";
  if (code === "EX" || code === "SU") return "expired";
  if (
    code === "CR" ||
    code === "GC" ||
    code === "UA" ||
    code === "GA" ||
    code === "SA"
  )
    return "created";
  return "error";
}

/** Pick the most "current balance"-like figure from a GoCardless balances list. */
export function pickBalance(
  balances: readonly GoCardlessBalance[] | null | undefined,
): { amount: number; currency: string } | null {
  if (!balances?.length) return null;
  const order = ["closingBooked", "interimBooked", "interimAvailable", "expected"];
  const chosen =
    order.map((t) => balances.find((b) => b.balanceType === t)).find(Boolean) ??
    balances[0];
  const amount = Number(chosen.balanceAmount.amount);
  if (!Number.isFinite(amount)) return null;
  return { amount, currency: chosen.balanceAmount.currency };
}
