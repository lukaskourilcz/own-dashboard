/**
 * Deterministic pairing of incoming bank payments with issued invoices.
 *
 * Czech invoicing already carries the join: the invoice prints a variable
 * symbol (variabilní symbol) and the payer copies it into the transfer, so a
 * payment that quotes an open invoice's symbol for the right amount is that
 * invoice's payment. No model, no heuristics, no scoring — a payment either
 * satisfies every rule below or it stays in the unmatched list for the owner to
 * link by hand.
 *
 * Pure and dependency-free on purpose: the cron, the on-demand button and the
 * unmatched-payments card all run the same function, and the unit tests run it
 * without a database.
 */

import { digitsOnly } from "@/lib/invoices";

/** Why a payment could not be paired. Rendered through i18n, never raw. */
export type UnmatchedReason =
  | "no-variable-symbol"
  | "no-open-invoice"
  | "currency-mismatch"
  | "amount-mismatch"
  | "duplicate-payment"
  | "ambiguous";

/** The transaction fields the matcher reads. */
export type MatchableTransaction = {
  id: string;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  note: string | null;
  occurred_on: string;
  variable_symbol?: string | null;
  invoice_id?: string | null;
};

/** The invoice fields the matcher reads. The total is injected separately. */
export type MatchableInvoice = {
  id: string;
  number: string;
  variable_symbol: string | null;
  currency: string;
  status: string;
  round_total: boolean;
};

export type PaymentMatch = {
  transactionId: string;
  invoiceId: string;
  /** The symbol both sides agreed on, normalised. */
  variableSymbol: string;
  /** The invoice total the payment was measured against. */
  total: number;
};

export type UnmatchedPayment = {
  transaction: MatchableTransaction;
  reason: UnmatchedReason;
  /** The symbol the payment quoted, when it quoted one at all. */
  variableSymbol: string | null;
  /** The invoice the reason is about, when exactly one was in play. */
  invoiceId: string | null;
};

export type MatchResult = {
  matched: PaymentMatch[];
  unmatched: UnmatchedPayment[];
  /** Incoming, still-unlinked payments considered in this pass. */
  scanned: number;
};

/** Digits only, capped at the ten the SPAYD spec allows. Empty → null. */
export function normalizeSymbol(value: string | null | undefined): string | null {
  const digits = digitsOnly(value ?? "").slice(0, 10);
  return digits.length > 0 ? digits : null;
}

// "VS: 2026001", "VS 2026001", "/VS/2026001/SS/0", "variabilní symbol 2026001".
// The separator class is deliberately narrow so "VS 2026 001" does not merge
// two numbers into one symbol.
const SYMBOL_PATTERNS: RegExp[] = [
  /variabiln[ií]\s*symbol\s*[:\-/]?\s*(\d{1,10})/i,
  /\bv\.?\s?s\.?\s*[:\-]\s*(\d{1,10})/i,
  /\/vs\/(\d{1,10})/i,
  /\bvs\s+(\d{1,10})\b/i,
];

/**
 * Read a variable symbol out of free remittance text. Only used as a fallback
 * for rows synced before `transactions.variable_symbol` existed — a bank that
 * sends a structured reference fills the column at ingest instead.
 */
export function extractVariableSymbol(note: string | null | undefined): string | null {
  const text = (note ?? "").trim();
  if (!text) return null;
  for (const pattern of SYMBOL_PATTERNS) {
    const found = pattern.exec(text);
    if (found?.[1]) return normalizeSymbol(found[1]);
  }
  return null;
}

/** The symbol a payment quotes: the stored column first, then its note. */
export function transactionSymbol(tx: MatchableTransaction): string | null {
  return normalizeSymbol(tx.variable_symbol) ?? extractVariableSymbol(tx.note);
}

/** The symbol an invoice asks for: its own field, else its number's digits. */
export function invoiceSymbol(invoice: MatchableInvoice): string | null {
  return normalizeSymbol(invoice.variable_symbol) ?? normalizeSymbol(invoice.number);
}

/**
 * How far a payment may sit from the invoice total and still be that payment.
 *
 * Derived from what the product already does rather than invented: a CZK
 * invoice with `round_total` is rounded to whole crowns by `computeTotals`, so
 * the payer can transfer up to a crown either side of the unrounded figure.
 * Everything else has to land on the cent.
 */
export function amountTolerance(invoice: MatchableInvoice): number {
  return invoice.round_total && invoice.currency.toUpperCase() === "CZK" ? 1 : 0.01;
}

type Candidate = { invoice: MatchableInvoice; total: number };

/**
 * Pair payments with invoices.
 *
 * `totals` maps invoice id → amount due, because an invoice has no total
 * column: it is derived from its items by `computeTotals`. Injecting it keeps
 * this function pure and lets the caller decide how the items were loaded.
 *
 * Every payment lands in exactly one of `matched` or `unmatched`, so the card
 * that renders the leftovers can explain each one.
 */
export function matchPayments(input: {
  invoices: MatchableInvoice[];
  totals: Map<string, number>;
  transactions: MatchableTransaction[];
}): MatchResult {
  const { invoices, totals, transactions } = input;

  // Open invoices grouped by the symbol they ask for. A symbol shared by two
  // open invoices is ambiguous and matches neither.
  const open = new Map<string, Candidate[]>();
  // Symbols that belong to an already-paid invoice, so a second payment quoting
  // one reads as a duplicate rather than as an unknown reference.
  const settled = new Set<string>();

  for (const invoice of invoices) {
    const symbol = invoiceSymbol(invoice);
    if (!symbol) continue;
    if (invoice.status === "issued") {
      const total = totals.get(invoice.id);
      if (total === undefined) continue;
      const bucket = open.get(symbol);
      if (bucket) bucket.push({ invoice, total });
      else open.set(symbol, [{ invoice, total }]);
    } else if (invoice.status === "paid") {
      settled.add(symbol);
    }
  }

  const matched: PaymentMatch[] = [];
  const unmatched: UnmatchedPayment[] = [];
  // One invoice takes one payment per pass; a second payment for the same
  // invoice is a duplicate the owner has to look at.
  const claimed = new Set<string>();

  // Oldest first, so when two payments quote the same invoice the earlier one
  // wins and the later one is the duplicate — which is the order a bank
  // statement reads in anyway.
  const ordered = [...transactions]
    .filter((tx) => tx.kind === "income" && !tx.invoice_id)
    .sort((a, b) =>
      a.occurred_on === b.occurred_on
        ? a.id.localeCompare(b.id)
        : a.occurred_on.localeCompare(b.occurred_on),
    );

  for (const tx of ordered) {
    const symbol = transactionSymbol(tx);
    if (!symbol) {
      unmatched.push({ transaction: tx, reason: "no-variable-symbol", variableSymbol: null, invoiceId: null });
      continue;
    }

    const candidates = open.get(symbol) ?? [];
    if (candidates.length === 0) {
      unmatched.push({
        transaction: tx,
        reason: settled.has(symbol) ? "duplicate-payment" : "no-open-invoice",
        variableSymbol: symbol,
        invoiceId: null,
      });
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({ transaction: tx, reason: "ambiguous", variableSymbol: symbol, invoiceId: null });
      continue;
    }

    const { invoice, total } = candidates[0];
    if (claimed.has(invoice.id)) {
      unmatched.push({ transaction: tx, reason: "duplicate-payment", variableSymbol: symbol, invoiceId: invoice.id });
      continue;
    }
    if (tx.currency.toUpperCase() !== invoice.currency.toUpperCase()) {
      unmatched.push({ transaction: tx, reason: "currency-mismatch", variableSymbol: symbol, invoiceId: invoice.id });
      continue;
    }
    if (Math.abs(tx.amount - total) > amountTolerance(invoice)) {
      unmatched.push({ transaction: tx, reason: "amount-mismatch", variableSymbol: symbol, invoiceId: invoice.id });
      continue;
    }

    claimed.add(invoice.id);
    matched.push({ transactionId: tx.id, invoiceId: invoice.id, variableSymbol: symbol, total });
  }

  return { matched, unmatched, scanned: ordered.length };
}
