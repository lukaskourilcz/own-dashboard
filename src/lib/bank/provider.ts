/**
 * The bank provider contract.
 *
 * Bank sync used to be GoCardless and nothing else: every route asked
 * `isGoCardlessConfigured()` and `syncConnection` called the GoCardless HTTP
 * client directly. GoCardless Bank Account Data no longer accepts new signups
 * and a PSD2 consent lapses after 90 days, so a forced re-authorisation or a
 * provider change was an outage rather than a configuration change.
 *
 * This module is the seam. It is deliberately dependency-free and carries no
 * `server-only` marker so it can be imported by tests and by type positions in
 * client components; every concrete adapter, and the registry that holds them,
 * is server-only.
 */
import type { BankConnection } from "@/lib/types";

/** Every provider the registry knows. A `bank_connections.provider` value
 *  outside this set fails closed rather than being treated as GoCardless. */
export type BankProviderId = "gocardless" | "fio" | "enable-banking";

export const BANK_PROVIDER_IDS = [
  "gocardless",
  "fio",
  "enable-banking",
] as const satisfies readonly BankProviderId[];

export function isBankProviderId(value: string): value is BankProviderId {
  return (BANK_PROVIDER_IDS as readonly string[]).includes(value);
}

/** A bank as offered by a provider's institution picker. */
export type ProviderInstitution = {
  id: string;
  name: string;
  bic: string | null;
  logo: string | null;
};

/** The result of starting a consent flow: where to send the browser, and the
 *  provider-side handle we store so the callback can finish the job. */
export type ProviderLink = {
  providerRef: string;
  consentUrl: string;
  /** ISO timestamp, or null when the provider does not state one. Never guessed. */
  consentExpiresAt: string | null;
};

export type ProviderConsentStatus = BankConnection["status"];

export type ProviderConsent = {
  status: ProviderConsentStatus;
  /** ISO timestamp the consent lapses, or null when unknown. */
  expiresAt: string | null;
  /** A short, non-sensitive reason shown beside an errored connection. */
  error: string | null;
};

export type ProviderAccount = {
  /** Stored in `accounts.external_ref`. Must be namespaced per provider unless
   *  it is GoCardless, whose refs are already in the database unprefixed. */
  accountRef: string;
  name: string;
  currency: string;
  balance: number | null;
};

/**
 * One transaction as a provider hands it over: the columns a bank can actually
 * supply. Ownership is deliberately absent — an adapter never names a user or a
 * local account row, so it cannot build a row for somebody else. The sync binds
 * both before the insert.
 */
export type ProviderTransaction = {
  kind: "income" | "expense";
  amount: number;
  currency: string;
  category: string | null;
  note: string | null;
  occurred_on: string;
  external_id: string;
  variable_symbol: string | null;
};

/**
 * A transactions row ready to insert. Exactly the shape the GoCardless mapper
 * has always produced, so the database contract is unchanged.
 */
export type NormalizedTransaction = ProviderTransaction & {
  user_id: string;
  account_id: string | null;
};

/** Bind a provider's transaction to its owner and local account row. */
export function bindTransaction(
  tx: ProviderTransaction,
  userId: string,
  accountId: string | null,
): NormalizedTransaction {
  return { ...tx, user_id: userId, account_id: accountId };
}

export type BeginLinkInput = {
  userId: string;
  institutionId: string;
  institutionName: string | null;
  redirect: string;
  reference: string;
};

/**
 * What the sync and the six bank routes are allowed to know about a bank.
 *
 * `beginLink` and `listInstitutions` are optional because a token provider
 * (Fio) has neither a redirect flow nor a bank list — the caller checks
 * `supportsInstitutionPicker` instead of assuming.
 */
export interface BankProvider {
  readonly id: BankProviderId;
  readonly label: string;
  /** False for token providers, which are configured in Settings, not by a redirect. */
  readonly supportsInstitutionPicker: boolean;
  /** True when this provider can be used right now. App-level providers read
   *  env; per-user providers read the owner's stored credential. */
  isConfigured(userId?: string): Promise<boolean>;
  listInstitutions?(country: string): Promise<ProviderInstitution[]>;
  beginLink?(input: BeginLinkInput): Promise<ProviderLink>;
  getConsent(conn: BankConnection): Promise<ProviderConsent>;
  listAccounts(conn: BankConnection): Promise<ProviderAccount[]>;
  fetchTransactions(
    conn: BankConnection,
    accountRef: string,
    since: string | null,
  ): Promise<ProviderTransaction[]>;
  revoke(conn: BankConnection): Promise<void>;
}

/** A stored `provider` value nothing is registered for. Thrown rather than
 *  defaulted, so a hand-edited row cannot silently sync as another bank. */
export class UnknownBankProviderError extends Error {
  readonly provider: string;
  constructor(provider: string) {
    super(`Unknown bank provider: ${provider}`);
    this.name = "UnknownBankProviderError";
    this.provider = provider;
  }
}

/** The provider exists but its credentials are unset. Callers turn this into a
 *  503 with an honest empty state rather than a generic failure. */
export class BankProviderNotConfiguredError extends Error {
  readonly provider: BankProviderId;
  constructor(provider: BankProviderId, detail?: string) {
    super(detail ?? `Bank provider ${provider} is not configured.`);
    this.name = "BankProviderNotConfiguredError";
    this.provider = provider;
  }
}

/** The provider is configured but the requested step is not available — used by
 *  an adapter whose live flow has not been verified against real credentials. */
export class BankProviderUnavailableError extends Error {
  readonly provider: BankProviderId;
  constructor(provider: BankProviderId, detail: string) {
    super(detail);
    this.name = "BankProviderUnavailableError";
    this.provider = provider;
  }
}
