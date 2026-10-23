import "server-only";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/lib/fx";
import { readTextPrefix } from "@/lib/bounded-text";
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
let tokenPending: Promise<string> | null = null;
async function jsonBody(response: Response, limit = 16 * 1024 * 1024): Promise<unknown> {
  const prefix = await readTextPrefix(response, limit);
  if (prefix.truncated) throw new Error("Bank response limit");
  return JSON.parse(prefix.text);
}

async function getAccessToken(): Promise<string> {
  const now = Date.now();
  if (tokenCache && tokenCache.expiresAt > now + 60_000) {
    return tokenCache.access;
  }
  if (tokenPending) return tokenPending;
  tokenPending = (async () => {
    const res = await fetch(`${BASE}/token/new/`, {
      method: "POST", headers: { "Content-Type": "application/json", accept: "application/json" },
      body: JSON.stringify({ secret_id: process.env.GOCARDLESS_SECRET_ID, secret_key: process.env.GOCARDLESS_SECRET_KEY }),
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) { await res.body?.cancel(); throw new GoCardlessError(res.status); }
    const json = z.object({ access: z.string().min(1).max(8192), access_expires: z.number().int().positive().safe() }).parse(await jsonBody(res, 16_384));
    tokenCache = { access: json.access, expiresAt: Date.now() + Math.min(json.access_expires, 86_400) * 1000 };
    return json.access;
  })();
  try { return await tokenPending; } finally { tokenPending = null; }
}

class GoCardlessError extends Error {
  status: number;
  constructor(status: number) {
    super(`Bank provider request failed (${status})`);
    this.name = "GoCardlessError";
    this.status = status;
  }
}

async function api(
  path: string,
  init?: RequestInit & { retryOn401?: boolean },
): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12_000),
  });
  // A stale cached token → drop it and retry once with a fresh one.
  if (res.status === 401 && init?.retryOn401 !== false) {
    if (tokenCache?.access === token) tokenCache = null;
    await res.body?.cancel();
    return api(path, { ...init, retryOn401: false });
  }
  if (!res.ok) { await res.body?.cancel(); throw new GoCardlessError(res.status); }
  if (res.status === 204) return undefined;
  return jsonBody(res);
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
  return api(`/institutions/?country=${encodeURIComponent(country)}`).then(value => z.array(z.object({
    id: z.string().min(1).max(256), name: z.string().min(1).max(160), bic: z.string().max(32).nullable().optional(), logo: z.string().max(2048).nullable().optional(),
  })).max(1000).parse(value).map(item => ({ ...item, bic: item.bic ?? undefined, logo: item.logo ?? undefined })));
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
  return api(`/requisitions/`, {
    method: "POST",
    body: JSON.stringify({
      institution_id: input.institutionId,
      redirect: input.redirect,
      reference: input.reference,
      user_language: input.userLanguage ?? "EN",
    }),
  }).then(value => requisitionSchema.parse(value));
}

const requisitionSchema = z.object({ id: z.uuid(), status: z.string().min(1).max(16), institution_id: z.string().max(256), reference: z.string().max(512),
  accounts: z.array(z.uuid()).max(50), link: z.string().max(2048), agreement: z.string().max(256).optional(),
});

export function getRequisition(id: string): Promise<Requisition> {
  return api(`/requisitions/${encodeURIComponent(id)}/`).then(value => requisitionSchema.parse(value));
}

export function deleteRequisition(id: string): Promise<void> {
  return api(`/requisitions/${encodeURIComponent(id)}/`, { method: "DELETE" }).then(() => undefined);
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
  return api(`/agreements/enduser/${encodeURIComponent(id)}/`).then(value => z.object({
    id: z.string(), created: z.string(), institution_id: z.string(), max_historical_days: z.number().int().nonnegative().optional(),
    access_valid_for_days: z.number().int().positive().max(36500).optional(), accepted: z.string().max(64).nullable().optional(),
  }).parse(value));
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
  return api(`/accounts/${encodeURIComponent(id)}/details/`).then(value => z.object({ account: z.object({
    currency: z.string().length(3).nullish().transform(value => value ?? undefined),
    name: z.string().max(256).nullish().transform(value => value ?? undefined),
    product: z.string().max(256).nullish().transform(value => value ?? undefined),
  }).nullish().transform(value => value ?? undefined) }).parse(value));
}

export type Balance = {
  balanceAmount: { amount: string; currency: string };
  balanceType?: string;
};

export function getAccountBalances(
  id: string,
): Promise<{ balances: Balance[] }> {
  return api(`/accounts/${encodeURIComponent(id)}/balances/`).then(value => z.object({ balances: z.array(z.object({
    balanceAmount: z.object({ amount: z.string().regex(/^[+-]?\d+(?:\.\d{1,2})?$/), currency: z.enum(SUPPORTED_CURRENCIES) }),
    balanceType: z.string().max(64).optional(),
  })).max(100) }).parse(value));
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
): Promise<{ transactions: { booked: GcTransaction[]; pending: unknown[] } }> {
  const q = dateFrom ? `?date_from=${encodeURIComponent(dateFrom)}` : "";
  return api(`/accounts/${encodeURIComponent(id)}/transactions/${q}`).then(value => z.object({ transactions: z.object({
    booked: z.array(gcTransactionSchema).max(20_000), pending: z.array(z.unknown()).max(20_000).optional().default([]),
  }) }).parse(value));
}

const optionalText = (max: number) => z.string().max(max).nullish().transform(value => value ?? undefined);
const optionalDate = z.iso.date().nullish().transform(value => value ?? undefined);
const gcTransactionSchema = z.object({
  transactionId: optionalText(512), internalTransactionId: optionalText(512),
  bookingDate: optionalDate, valueDate: optionalDate,
  transactionAmount: z.object({ amount: z.string().regex(/^[+-]?\d+(?:\.\d{1,2})?$/), currency: z.enum(SUPPORTED_CURRENCIES) }),
  remittanceInformationUnstructured: optionalText(100_000),
  remittanceInformationUnstructuredArray: z.array(z.string().max(10_000)).max(100).nullish().transform(value => value ?? undefined),
  remittanceInformationStructured: optionalText(10_000), additionalInformation: optionalText(100_000),
  endToEndId: optionalText(512), creditorName: optionalText(1000), debtorName: optionalText(1000),
});

/* --------------------------- mapping to our rows -------------------------- */

/**
 * Normalise a GoCardless booked transaction into the provider-neutral row the
 * sync inserts. Amount sign decides income vs expense; we store the absolute
 * value (the DB enforces amount >= 0). A stable external_id dedupes across
 * re-syncs. Ownership is bound by the sync, never here.
 */
export function mapTransaction(tx: GcTransaction): ProviderTransaction | null {
  const parsed = gcTransactionSchema.safeParse(tx);
  if (!parsed.success) return null;
  const raw = Number(parsed.data.transactionAmount.amount);
  if (!Number.isFinite(raw) || Math.abs(raw) > 999999999999.99) return null;
  const id = tx.transactionId?.trim() ? tx.transactionId : tx.internalTransactionId;
  // Missing bank identity is ambiguous. Refuse the statement rather than merge
  // distinct payments using a short date/amount/description fingerprint.
  if (!id?.trim() || !(tx.bookingDate || tx.valueDate)) return null;
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
    note: note ? [...note].slice(0, 500).join("") : null,
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
