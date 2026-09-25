import "server-only";
import { enableBankingProvider } from "@/lib/bank/enable-banking-adapter";
import { fioProvider } from "@/lib/bank/fio-adapter";
import { gocardlessProvider } from "@/lib/bank/gocardless-adapter";
import {
  BANK_PROVIDER_IDS,
  UnknownBankProviderError,
  isBankProviderId,
  type BankProvider,
  type BankProviderId,
} from "@/lib/bank/provider";

/**
 * The single place anything asks "which bank providers exist, and is bank sync
 * usable right now". Before this existed, five routes and the cron each asked
 * `isGoCardlessConfigured()`, so an install without GoCardless credentials went
 * dark for every other provider too.
 */

const PROVIDERS: Record<BankProviderId, BankProvider> = {
  gocardless: gocardlessProvider,
  fio: fioProvider,
  "enable-banking": enableBankingProvider,
};

/** Resolve a stored `bank_connections.provider` value. Throws for anything
 *  unregistered, so a hand-edited row fails closed rather than quietly syncing
 *  against the wrong bank. */
export function getProvider(id: string): BankProvider {
  if (!isBankProviderId(id)) throw new UnknownBankProviderError(id);
  return PROVIDERS[id];
}

export function listProviders(): BankProvider[] {
  return BANK_PROVIDER_IDS.map((id) => PROVIDERS[id]);
}

/** Which providers this owner could sync with right now. Never throws: one
 *  provider whose configuration check fails must not hide the others. */
export async function configuredProviders(
  userId: string,
): Promise<BankProviderId[]> {
  const checks = await Promise.all(
    listProviders().map(async (provider) => {
      try {
        return (await provider.isConfigured(userId)) ? provider.id : null;
      } catch {
        return null;
      }
    }),
  );
  return checks.filter((id): id is BankProviderId => id !== null);
}

/** Configuration state per provider, for Settings and the connect dialog. No
 *  secret or token value may ever be added to this shape. */
export async function providerAvailability(userId: string): Promise<
  {
    id: BankProviderId;
    label: string;
    configured: boolean;
    supportsInstitutionPicker: boolean;
  }[]
> {
  const configured = new Set(await configuredProviders(userId));
  return listProviders().map((provider) => ({
    id: provider.id,
    label: provider.label,
    configured: configured.has(provider.id),
    supportsInstitutionPicker: provider.supportsInstitutionPicker,
  }));
}
