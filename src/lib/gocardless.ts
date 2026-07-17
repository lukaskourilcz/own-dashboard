import "server-only";

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

/* ------------------------------- accounts ------------------------------- */

export type AccountMeta = {
  id: string;
  iban?: string;
  institution_id?: string;
  currency?: string;
  ownerName?: string;
  name?: string;
};

export function getAccountMeta(id: string): Promise<AccountMeta> {
  return api<AccountMeta>(`/accounts/${encodeURIComponent(id)}/`);
}

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
 * Normalise a GoCardless booked transaction into our transactions-row shape.
 * Amount sign decides income vs expense; we store the absolute value (the DB
 * enforces amount >= 0). A stable external_id dedupes across re-syncs.
 */
export function mapTransaction(
  tx: GcTransaction,
  userId: string,
  accountId: string | null,
): {
  user_id: string;
  account_id: string | null;
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  occurred_on: string;
  external_id: string;
} | null {
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
    user_id: userId,
    account_id: accountId,
    kind: raw < 0 ? "expense" : "income",
    amount: Math.abs(raw),
    currency: tx.transactionAmount.currency,
    category: null,
    note: note ? note.slice(0, 500) : null,
    occurred_on: (tx.bookingDate ?? tx.valueDate ?? "").slice(0, 10),
    external_id: id,
  };
}
