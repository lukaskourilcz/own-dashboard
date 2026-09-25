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
 * The HTTP client in `src/lib/gocardless.ts` is unchanged; this file is the
 * adapter that turns it into a `BankProvider`, plus the one thing the old code
 * never modelled — when the 90-day consent lapses. GoCardless states that only
 * on the end-user agreement, so the expiry is read from there and stays null
 * when the requisition carries no agreement.
 */

/** GoCardless keeps a requisition's account ids bare in `accounts.external_ref`
 *  because that is how they were first written; re-prefixing them would orphan
 *  every existing row. */
async function consentExpiry(agreementId: string | undefined): Promise<string | null> {
  if (!agreementId) return null;
  const agreement = await getEndUserAgreement(agreementId).catch(() => null);
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

export const gocardlessProvider: BankProvider = {
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
    return {
      providerRef: requisition.id,
      consentUrl: requisition.link,
      consentExpiresAt: await consentExpiry(requisition.agreement),
    };
  },

  async getConsent(conn: BankConnection): Promise<ProviderConsent> {
    const ref = requisitionRef(conn);
    if (!ref) {
      return { status: "error", expiresAt: null, error: "missing-requisition" };
    }
    const requisition = await getRequisition(ref);
    const status = mapRequisitionStatus(requisition.status);
    return {
      status,
      expiresAt: await consentExpiry(requisition.agreement),
      error: status === "error" ? `requisition ${requisition.status}` : null,
    };
  },

  async listAccounts(conn: BankConnection): Promise<ProviderAccount[]> {
    const ref = requisitionRef(conn);
    if (!ref) return [];
    const requisition = await getRequisition(ref);
    const accounts: ProviderAccount[] = [];
    for (const accountRef of requisition.accounts ?? []) {
      const details = await getAccountDetails(accountRef).catch(() => null);
      const balances = await getAccountBalances(accountRef).catch(() => null);
      const balance = balances ? pickBalance(balances.balances) : null;
      accounts.push({
        accountRef,
        name:
          details?.account?.name ??
          details?.account?.product ??
          conn.institution_name ??
          "Bank account",
        currency: balance?.currency ?? details?.account?.currency ?? "EUR",
        balance: balance?.amount ?? null,
      });
    }
    return accounts;
  },

  async fetchTransactions(
    _conn: BankConnection,
    accountRef: string,
    since: string | null,
  ): Promise<ProviderTransaction[]> {
    const response = await getAccountTransactions(
      accountRef,
      since ?? undefined,
    ).catch(() => null);
    const booked = response?.transactions?.booked ?? [];
    return booked
      .map((tx) => mapTransaction(tx))
      .filter((tx): tx is ProviderTransaction => tx !== null && !!tx.occurred_on);
  },

  async revoke(conn: BankConnection): Promise<void> {
    const ref = requisitionRef(conn);
    if (!ref) return;
    await deleteRequisition(ref);
  },
};
