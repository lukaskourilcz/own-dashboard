import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) },
  from: () => ({ select: () => ({ eq: async () => ({ data: [{ provider: "gocardless", status: "linked", last_synced_at: null }] }) }) }),
}) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }));
vi.mock("@/lib/bank/registry", () => ({ providerAvailability: async () => [
  { id: "gocardless", label: "GoCardless", configured: true, supportsInstitutionPicker: true },
  { id: "fio", label: "Fio banka", configured: false, supportsInstitutionPicker: false },
] }));
import { GET } from "@/app/api/integrations/status/route";
import { bankProvidersResponse } from "@/lib/bank/flow";
it("the actual status response preserves the capability the picker requires", async () => {
  const response = await GET();
  const providers = bankProvidersResponse.parse(await response.json()).bank.providers;
  expect(providers).toEqual([
    { id: "gocardless", label: "GoCardless", configured: true, connected: true, supportsInstitutionPicker: true },
    { id: "fio", label: "Fio banka", configured: false, connected: false, supportsInstitutionPicker: false },
  ]);
  expect(response.headers.get("cache-control")).toBe("private, no-store");
});
