import { z } from "zod";

const providerSchema = z.object({
  id: z.enum(["gocardless", "fio", "enable-banking"]),
  label: z.string().trim().min(1).max(160),
  configured: z.boolean(),
  connected: z.boolean(),
  supportsInstitutionPicker: z.boolean(),
});
export type BankProviderState = z.infer<typeof providerSchema>;
export const bankProvidersResponse = z.object({ bank: z.object({ providers: z.array(providerSchema).max(3) }) });

const institutionSchema = z.object({
  id: z.string().min(1).max(256), name: z.string().min(1).max(160),
  bic: z.string().max(32).nullable(), logo: z.string().max(2048).nullable(),
});
export const bankInstitutionsResponse = z.object({ institutions: z.array(institutionSchema).max(1000) });
export type BankInstitution = z.infer<typeof institutionSchema>;

/** Only the implemented consent provider can redirect. The host is documented
 * in GoCardless's Bank Account Data quickstart; no arbitrary upstream URL is
 * navigable. Stored legacy requisitions do not use this new-link boundary.
 */
export function bankConsentUrl(provider: string, value: unknown): string {
  if (provider !== "gocardless" || typeof value !== "string" || value.length > 2048) throw new Error("Invalid consent link");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "ob.gocardless.com" || url.port || url.username || url.password
    || !url.pathname.startsWith("/psd2/start/")) throw new Error("Invalid consent link");
  return url.href;
}
