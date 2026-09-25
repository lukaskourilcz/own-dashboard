import "server-only";
import { signEnableBankingJwt } from "@/lib/bank/enable-banking-jwt";
import {
  BankProviderNotConfiguredError,
  BankProviderUnavailableError,
  type BankProvider,
  type ProviderAccount,
  type ProviderConsent,
  type ProviderTransaction,
} from "@/lib/bank/provider";

/**
 * Enable Banking — registered, deliberately unconfigured.
 *
 * Enable Banking is the PSD2 aggregator the issue names as the replacement path
 * for GoCardless: 2,700+ EU banks including the Czech ones, and a free
 * restricted-production tier for the owner's own accounts. Using it needs three
 * things this repository cannot produce — an account, an RSA key pair, and an
 * application id issued after the public key is uploaded.
 *
 * So the provider is registered and its configuration is detected honestly,
 * and the one piece that can be built and tested without credentials — the
 * RS256 assertion every call is signed with — is built. Every data method fails
 * with a typed error instead of calling an endpoint nobody here can execute:
 * an unverified request path would read as a working integration while being
 * pure guesswork. `docs/external-setup.md` carries the setup steps.
 */

function credentials(): { applicationId: string; privateKeyPem: string } | null {
  const applicationId = process.env.ENABLE_BANKING_APPLICATION_ID;
  const privateKeyPem = process.env.ENABLE_BANKING_PRIVATE_KEY;
  if (!applicationId || !privateKeyPem) return null;
  return { applicationId, privateKeyPem: privateKeyPem.replace(/\\n/g, "\n") };
}

/** The `Authorization` value every Enable Banking call would carry. Exported so
 *  the credential pair can be proved correct the moment the owner sets it. */
export function enableBankingAuthorization(): string {
  const pair = credentials();
  if (!pair) throw new BankProviderNotConfiguredError("enable-banking");
  return `Bearer ${signEnableBankingJwt(pair)}`;
}

function unavailable(): never {
  if (!credentials()) throw new BankProviderNotConfiguredError("enable-banking");
  throw new BankProviderUnavailableError(
    "enable-banking",
    "Enable Banking credentials are set, but this adapter's live request flow " +
      "has not been verified against a registered application. See " +
      "docs/external-setup.md before enabling it.",
  );
}

export const enableBankingProvider: BankProvider = {
  id: "enable-banking",
  label: "Enable Banking",
  supportsInstitutionPicker: true,

  async isConfigured(): Promise<boolean> {
    return credentials() !== null;
  },

  // Declared without parameters on purpose: nothing here may look like it is
  // about to use a connection it cannot serve.
  async getConsent(): Promise<ProviderConsent> {
    return unavailable();
  },

  async listAccounts(): Promise<ProviderAccount[]> {
    return unavailable();
  },

  async fetchTransactions(): Promise<ProviderTransaction[]> {
    return unavailable();
  },

  async revoke(): Promise<void> {
    return unavailable();
  },
};
