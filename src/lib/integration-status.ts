import { z } from "zod";
import { bankProvidersResponse } from "@/lib/bank/flow";

const connection = z.object({ connected: z.boolean(), configured: z.boolean() });
export const integrationStatusSchema = z.object({
  google: connection,
  github: connection,
  bank: bankProvidersResponse.shape.bank.extend({
    connected: z.boolean(), configured: z.boolean(), last_synced_at: z.iso.datetime({ offset: true }).nullable(),
  }),
  email: z.object({ configured: z.boolean() }),
});
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;

export async function fetchIntegrationStatus({ signal }: { signal: AbortSignal }): Promise<IntegrationStatus> {
  const response = await fetch("/api/integrations/status", {
    cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
  if (!response.ok) throw new Error("Integration status unavailable");
  const result = integrationStatusSchema.parse(await response.json());
  if (new Set(result.bank.providers.map(provider => provider.id)).size !== result.bank.providers.length) throw new Error("Integration status unavailable");
  return result;
}
