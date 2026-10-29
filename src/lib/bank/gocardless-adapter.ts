import "server-only";
import {
  createRequisition,
  deleteRequisition,
  getAccountBalances,
  getAccountDetails,
  getAccountTransactions,
  getEndUserAgreement,
  getRequisition,
  isGoCardlessConfigured,
  listInstitutions,
  mapTransaction,
} from "@/lib/gocardless";
import {
  mapRequisitionStatus,
  pickBalance,
} from "@/lib/bank/gocardless-mapping";
import type {
  BankProvider,
  BeginLinkInput,
  ProviderAccount,
  ProviderConsent,
  ProviderInstitution,
  ProviderLink,
  ProviderTransaction,
} from "@/lib/bank/provider";
import type { BankConnection } from "@/lib/types";

/**
 * GoCardless Bank Account Data behind the provider interface.
 *
 * The HTTP client in `src/lib/gocardless.ts` validates provider responses; this
 * adapter adds consent and account semantics. GoCardless states expiry only
 * on the end-user agreement, so the expiry is read from there and stays null
 * when the requisition carries no agreement.
 */

/** GoCardless keeps a requisition's account ids bare in `accounts.external_ref`
 *  because that is how they were first written; re-prefixing them would orphan
 *  every existing row. */
async function consentExpiry(agreementId: string | undefined, signal?: AbortSignal): Promise<string | null> {
  if (!agreementId) return null;
  const agreement = await getEndUserAgreement(agreementId, signal).catch(() => null);
  if (!agreement?.accepted || !agreement.access_valid_for_days) return null;
  const accepted = new Date(agreement.accepted);
  if (Number.isNaN(accepted.getTime())) return null;
  const expires = new Date(accepted);
  expires.setUTCDate(expires.getUTCDate() + agreement.access_valid_for_days);
  return expires.toISOString();
}

function requisitionRef(conn: BankConnection): string {
  return conn.provider_ref ?? conn.requisition_id ?? "";
}

export function createGoCardlessProvider(signal?: AbortSignal): BankProvider {
  const requisitions = new Map<string, ReturnType<typeof getRequisition>>();
  function readRequisition(conn: BankConnection) {
    const ref = requisitionRef(conn), key = `${conn.user_id}:${ref}`;
    let pending = requisitions.get(key);
    if (!pending) {
      pending = getRequisition(ref, signal).then(result => {
        if (result.id !== ref || result.reference !== conn.reference
          || (conn.institution_id && result.institution_id !== conn.institution_id)) throw new Error("bank-requisition-mismatch");
        return result;
      });
      requisitions.set(key, pending);
    }
    return pending;
  }
  return {
    id: "gocardless",
    label: "GoCardless",
    supportsInstitutionPicker: true,

    async isConfigured(): Promise<boolean> {
      return isGoCardlessConfigured();
    },

    async listInstitutions(country: string): Promise<ProviderInstitution[]> {
      const institutions = await listInstitutions(country);
      return institutions.map((institution) => ({
        id: institution.id,
        name: institution.name,
        bic: institution.bic ?? null,
        logo: institution.logo ?? null,
      }));
    },

    async beginLink(input: BeginLinkInput): Promise<ProviderLink> {
      const requisition = await createRequisition({
        institutionId: input.institutionId,
        redirect: input.redirect,
        reference: input.reference,
      });
      if (requisition.reference !== input.reference || requisition.institution_id !== input.institutionId) throw new Error("bank-requisition-mismatch");
      return {
        providerRef: requisition.id,
        consentUrl: requisition.link,
        consentExpiresAt: await consentExpiry(requisition.agreement, signal),
      };
    },

    async getConsent(conn: BankConnection): Promise<ProviderConsent> {
      const ref = requisitionRef(conn);
      if (!ref) {
        return { status: "error", expiresAt: null, error: "missing-requisition" };
      }
      const requisition = await readRequisition(conn);
      const status = mapRequisitionStatus(requisition.status);
      return {
        status,
        expiresAt: await consentExpiry(requisition.agreement, signal) ?? conn.consent_expires_at,
        error: status === "error" ? `requisition ${requisition.status}` : null,
      };
    },

    async listAccounts(conn: BankConnection): Promise<ProviderAccount[]> {
      const ref = requisitionRef(conn);
      if (!ref) return [];
      const requisition = await readRequisition(conn);
      const accounts: ProviderAccount[] = [];
      for (const accountRef of requisition.accounts ?? []) {
        const [details, balances] = await Promise.all([getAccountDetails(accountRef, signal).catch(() => null), getAccountBalances(accountRef, signal).catch(() => null)]);
        const balance = balances ? pickBalance(balances.balances, details?.account?.currency) : null;
        const currency = balance?.currency ?? details?.account?.currency;
        if (!currency) throw new Error("bank-account-currency-unavailable");
        accounts.push({
          accountRef,
          name:
            details?.account?.name ??
            details?.account?.product ??
            conn.institution_name ??
            "Bank account",
          currency,
          balance: balance?.amount ?? null,
        });
      }
      return accounts;
    },

    // Every pull reads the whole window the consent allows, as it did before
    // the provider interface: a bank can book a payment days after it happened,
    // and a `date_from` at the last sync day would skip it for good. The dedupe
    // on `external_id` makes the repeat safe, so the sync cursor is not read.
    // A failed pull throws: `syncConnection` then records `last_error` and
    // keeps the cursor. Returning an empty list would look like a quiet day.
    async fetchTransactions(
      _conn: BankConnection,
      accountRef: string,
    ): Promise<ProviderTransaction[]> {
      const response = await getAccountTransactions(accountRef, undefined, signal);
      const booked = response?.transactions?.booked;
      if (!Array.isArray(booked) || booked.length > 20_000) throw new Error("bank-transactions-unavailable");
      const ids = new Set<string>();
      return booked.map(tx => {
        const mapped = mapTransaction(tx);
        if (!mapped || !mapped.occurred_on || ids.has(mapped.external_id)) throw new Error("bank-transaction-invalid");
        ids.add(mapped.external_id);
        return mapped;
      });
    },

    async revoke(conn: BankConnection): Promise<void> {
      const ref = requisitionRef(conn);
      if (!ref) return;
      await deleteRequisition(ref);
    },
  };
}
