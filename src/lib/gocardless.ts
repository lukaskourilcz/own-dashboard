import "server-only";
import type { ProviderTransaction } from "@/lib/bank/provider";
import { extractVariableSymbol, normalizeSymbol } from "@/lib/payment-matching";

/**
 * GoCardless Bank Account Data (formerly Nordigen) — read-only account &
 * transaction access under PSD2. GoCardless is the licensed AISP, so this app
 * never needs its own banking licence: it authenticates with an app-level
 * secret pair and the end user consents by logging into their bank.
 *
 * Flow: token → pick institution → create requisition (redirect user to the
 * bank) → on return, the requisition lists account ids → pull balances +
 * transactions. Docs: https://developer.gocardless.com/bank-account-data
 *
 * All exports are server-only; the secrets never reach the browser.
 */

const BASE = "https://bankaccountdata.gocardless.com/api/v2";

export function isGoCardlessConfigured(): boolean {
  return Boolean(
    process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY,
  );
}

/* ----------------------------- access token ----------------------------- */

// Access tokens live ~24h. Cache in module memory and refresh a minute early.
let tokenCache: { access: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.access;
  }
  const res = await fetch(`${BASE}/token/new/`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      secret_id: process.env.GOCARDLESS_SECRET_ID,
      secret_key: process.env.GOCARDLESS_SECRET_KEY,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new GoCardlessError(
      `token request failed (${res.status})`,
      res.status,
    );
  }
  const json = (await res.json()) as { access: string; access_expires: number };
  tokenCache = {
    access: json.access,
    expiresAt: now + (json.access_expires ?? 86_400) * 1000,
  };
  return json.access;
}

export class GoCardlessError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "GoCardlessError";
    this.status = status;
  }
}

async function api<T>(
  path: string,
  init?: RequestInit & { retryOn401?: boolean },
): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });
  // A stale cached token → drop it and retry once with a fresh one.
  if (res.status === 401 && init?.retryOn401 !== false) {
    tokenCache = null;
    return api<T>(path, { ...init, retryOn401: false });
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new GoCardlessError(
      `${init?.method ?? "GET"} ${path} → ${res.status} ${detail.slice(0, 300)}`,
      res.status,
    );
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ----------------------------- institutions ----------------------------- */

export type Institution = {
  id: string;
  name: string;
  bic?: string;
  logo?: string;
  transaction_total_days?: string;
};

export function listInstitutions(country = "cz"): Promise<Institution[]> {
  return api<Institution[]>(
    `/institutions/?country=${encodeURIComponent(country)}`,
  );
}

/* ----------------------------- requisitions ----------------------------- */

export type Requisition = {
  id: string;
  status: string;
  institution_id: string;
  reference: string;
  accounts: string[];
  link: string;
  /** End-user agreement id, when the requisition was created with one. */
  agreement?: string;
};

export function createRequisition(input: {
  institutionId: string;
  redirect: string;
  reference: string;
  userLanguage?: string;
}): Promise<Requisition> {
  return api<Requisition>(`/requisitions/`, {
    method: "POST",
    body: JSON.stringify({
      institution_id: input.institutionId,
      redirect: input.redirect,
      reference: input.reference,
      user_language: input.userLanguage ?? "EN",
    }),
  });
}

export function getRequisition(id: string): Promise<Requisition> {
  return api<Requisition>(`/requisitions/${encodeURIComponent(id)}/`);
}

export function deleteRequisition(id: string): Promise<void> {
  return api<void>(`/requisitions/${encodeURIComponent(id)}/`, {
    method: "DELETE",
  });
}

/**
 * The end-user agreement behind a requisition. This is the only place the
 * 90-day PSD2 consent window is stated as data: `accepted` plus
 * `access_valid_for_days` is the lapse date. A requisition created without an
 * explicit agreement has no id here, and the expiry then stays unknown rather
 * than being guessed.
 */
export type EndUserAgreement = {
  id: string;
  created: string;
  institution_id: string;
  max_historical_days?: number;
  access_valid_for_days?: number;
  accepted?: string | null;
};

export function getEndUserAgreement(id: string): Promise<EndUserAgreement> {
  return api<EndUserAgreement>(
    `/agreements/enduser/${encodeURIComponent(id)}/`,
  );
}

/* ------------------------------- accounts ------------------------------- */

export type AccountDetails = {
  account?: {
    iban?: string;
    currency?: string;
    name?: string;
    ownerName?: string;
    product?: string;
  };
};

export function getAccountDetails(id: string): Promise<AccountDetails> {
  return api<AccountDetails>(`/accounts/${encodeURIComponent(id)}/details/`);
}

export type Balance = {
  balanceAmount: { amount: string; currency: string };
  balanceType?: string;
};

export function getAccountBalances(
  id: string,
): Promise<{ balances: Balance[] }> {
  return api<{ balances: Balance[] }>(
    `/accounts/${encodeURIComponent(id)}/balances/`,
  );
}

export type GcTransaction = {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  // Czech banks put the variable symbol here, either as a structured reference
  // or inside the free-text additional information. Both are optional in the
  // PSD2 schema, so nothing downstream may assume one is present.
  remittanceInformationStructured?: string;
  additionalInformation?: string;
  endToEndId?: string;
  creditorName?: string;
  debtorName?: string;
};

export function getAccountTransactions(
  id: string,
  dateFrom?: string,
): Promise<{ transactions: { booked: GcTransaction[]; pending: GcTransaction[] } }> {
  const q = dateFrom ? `?date_from=${encodeURIComponent(dateFrom)}` : "";
  return api(`/accounts/${encodeURIComponent(id)}/transactions/${q}`);
}

/* --------------------------- mapping to our rows -------------------------- */

/**
 * Normalise a GoCardless booked transaction into the provider-neutral row the
 * sync inserts. Amount sign decides income vs expense; we store the absolute
 * value (the DB enforces amount >= 0). A stable external_id dedupes across
 * re-syncs. Ownership is bound by the sync, never here.
 */
export function mapTransaction(tx: GcTransaction): ProviderTransaction | null {
  const raw = Number(tx.transactionAmount?.amount);
  if (!Number.isFinite(raw)) return null;
  const id =
    tx.transactionId ??
    tx.internalTransactionId ??
    // Last-resort fingerprint when the bank omits an id.
    `gc:${tx.bookingDate ?? ""}:${tx.transactionAmount?.amount}:${(
      tx.remittanceInformationUnstructured ?? ""
    ).slice(0, 40)}`;
  const note =
    tx.remittanceInformationUnstructured ??
    tx.remittanceInformationUnstructuredArray?.join(" ") ??
    tx.creditorName ??
    tx.debtorName ??
    null;
  return {
    kind: raw < 0 ? "expense" : "income",
    amount: Math.abs(raw),
    currency: tx.transactionAmount.currency,
    category: null,
    note: note ? note.slice(0, 500) : null,
    occurred_on: (tx.bookingDate ?? tx.valueDate ?? "").slice(0, 10),
    external_id: id,
    variable_symbol: variableSymbol(tx),
  };
}

/**
 * The Czech variable symbol carried by a payment. A structured reference that
 * is nothing but digits is the symbol itself; anything else is scanned for a
 * "VS …" form. Null when the bank sent neither, which is normal — the matcher
 * then reads the note.
 */
function variableSymbol(tx: GcTransaction): string | null {
  const structured = (tx.remittanceInformationStructured ?? "").trim();
  if (/^\d{1,10}$/.test(structured)) return structured;
  const texts = [
    structured,
    tx.remittanceInformationUnstructured ?? "",
    tx.remittanceInformationUnstructuredArray?.join(" ") ?? "",
    tx.additionalInformation ?? "",
    tx.endToEndId ?? "",
  ];
  for (const text of texts) {
    const found = extractVariableSymbol(text);
    if (found) return found;
  }
  // An end-to-end id that is only digits is a reference too.
  const endToEnd = (tx.endToEndId ?? "").trim();
  return /^\d{1,10}$/.test(endToEnd) ? normalizeSymbol(endToEnd) : null;
}
