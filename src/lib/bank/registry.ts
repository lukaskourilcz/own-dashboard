import "server-only";
import { enableBankingProvider } from "@/lib/bank/enable-banking-adapter";
import { createFioProvider } from "@/lib/bank/fio-adapter";
import { createGoCardlessProvider } from "@/lib/bank/gocardless-adapter";
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

const PROVIDERS: Record<BankProviderId, (signal?: AbortSignal) => BankProvider> = {
  gocardless: createGoCardlessProvider,
  fio: createFioProvider,
  "enable-banking": () => enableBankingProvider,
};

/** Resolve a stored `bank_connections.provider` value. Throws for anything
 *  unregistered, so a hand-edited row fails closed rather than quietly syncing
 *  against the wrong bank. */
export function getProvider(id: string, signal?: AbortSignal): BankProvider {
  if (!isBankProviderId(id)) throw new UnknownBankProviderError(id);
  return PROVIDERS[id](signal);
}

export function listProviders(signal?: AbortSignal): BankProvider[] {
  return BANK_PROVIDER_IDS.map(id => getProvider(id, signal));
}

/** A failed configuration read is unavailable, never evidence that a provider
 * is unconfigured. Callers must surface/retry that failure. */
export async function configuredProviders(userId: string, signal?: AbortSignal): Promise<BankProviderId[]> {
  return (await providerAvailability(userId, signal)).filter(provider => provider.configured).map(provider => provider.id);
}

/** Configuration state only. No credential values enter this response. */
export async function providerAvailability(userId: string, signal?: AbortSignal): Promise<{
  id: BankProviderId;
  label: string;
  configured: boolean;
  supportsInstitutionPicker: boolean;
}[]> {
  return Promise.all(listProviders(signal).map(async provider => ({
    id: provider.id,
    label: provider.label,
    configured: await provider.isConfigured(userId),
    supportsInstitutionPicker: provider.supportsInstitutionPicker,
  })));
}
