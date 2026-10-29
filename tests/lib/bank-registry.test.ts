import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const state = vi.hoisted(() => ({ fio: vi.fn(), gc: vi.fn(), eb: vi.fn() }));
vi.mock("@/lib/bank/fio-adapter", () => ({ createFioProvider: () => ({ id: "fio", label: "Fio", supportsInstitutionPicker: false, isConfigured: state.fio }) }));
vi.mock("@/lib/bank/gocardless-adapter", () => ({ createGoCardlessProvider: () => ({ id: "gocardless", label: "GoCardless", supportsInstitutionPicker: true, isConfigured: state.gc }) }));
vi.mock("@/lib/bank/enable-banking-adapter", () => ({ enableBankingProvider: { id: "enable-banking", label: "Enable Banking", supportsInstitutionPicker: true, isConfigured: state.eb } }));
import { configuredProviders, providerAvailability } from "@/lib/bank/registry";
beforeEach(() => { state.fio.mockReset().mockResolvedValue(false); state.gc.mockReset().mockResolvedValue(true); state.eb.mockReset().mockResolvedValue(false); });
it("distinguishes confirmed absence from configured providers", async () => {
  expect(await configuredProviders("owner")).toEqual(["gocardless"]);
  expect((await providerAvailability("owner")).find(provider => provider.id === "fio")?.configured).toBe(false);
});
it("propagates a failed check even when another provider is usable", async () => {
  state.fio.mockRejectedValue(Error("status unavailable"));
  await expect(providerAvailability("owner")).rejects.toThrow("status unavailable");
  await expect(configuredProviders("owner")).rejects.toThrow("status unavailable");
});
