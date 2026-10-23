import { expect, it } from "vitest";
import { bankConsentUrl, bankInstitutionsResponse, bankProvidersResponse } from "@/lib/bank/flow";

it("requires the provider capability rather than silently choosing a token form", () => {
  const provider = { id: "gocardless", label: "GoCardless", configured: true, connected: false };
  expect(bankProvidersResponse.safeParse({ bank: { providers: [provider] } }).success).toBe(false);
  expect(bankProvidersResponse.parse({ bank: { providers: [{ ...provider, supportsInstitutionPicker: true }] } }).bank.providers[0].supportsInstitutionPicker).toBe(true);
  expect(bankInstitutionsResponse.safeParse({ institutions: [{ id: "bank", name: null }] }).success).toBe(false);
});
it.each(["javascript:alert(1)", "https://example.com/psd2/start/id", "http://ob.gocardless.com/psd2/start/id", "https://user:pass@ob.gocardless.com/psd2/start/id", "https://ob.gocardless.com:444/psd2/start/id", "https://ob.gocardless.com/other"])('refuses an unsupported consent destination (%s)', url => {
  expect(() => bankConsentUrl("gocardless", url)).toThrow();
});
it("accepts the documented provider URL only for the implemented redirect adapter", () => {
  const url = "https://ob.gocardless.com/psd2/start/11111111-1111-4111-8111-111111111111/BANK";
  expect(bankConsentUrl("gocardless", url)).toBe(url);
  expect(() => bankConsentUrl("fio", url)).toThrow();
});
