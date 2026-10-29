import { afterEach, expect, it, vi } from "vitest";
import { renewalEmail, renewalEventIdentity, sendRenewalEmail } from "@/lib/renewal-email";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllGlobals());
it.each(["en", "cs"] as const)("keeps %s renewal dates and amount confirmation explicit", lang => {
  const input = { name: "Synthetic subscription", amount: 25, currency: "EUR", date: "2026-10-25", today: true, confirmed: false, lang };
  const mail = renewalEmail(input); expect(mail.text).toContain(input.date); expect(mail.text).toContain(lang === "en" ? "not checked against an invoice" : "neověřeno podle faktury");
  expect(renewalEmail({ ...input, confirmed: true }).text).not.toContain(lang === "en" ? "not checked" : "neověřeno");
});
it("keeps event identity stable across retries and distinct across renewal dates/kinds", () => {
  const first = renewalEventIdentity("owner", "subscription", "0d", "2026-10-25"); expect(first).toEqual(renewalEventIdentity("owner", "subscription", "0d", "2026-10-25"));
  expect(first.id).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/);
  expect(first.key).not.toBe(renewalEventIdentity("owner", "subscription", "3d", "2026-10-25").key); expect(first.key).not.toBe(renewalEventIdentity("owner", "subscription", "0d", "2026-11-25").key);
});
it("sends once to the fixed origin with the stable idempotency header", async () => {
  const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id: "11111111-1111-4111-8111-111111111111" })); vi.stubGlobal("fetch", fetcher);
  const payload = { from: "fixture@example.test", to: "owner@example.test", subject: "Synthetic", text: "Synthetic" };
  expect(await sendRenewalEmail(payload, "renewal/synthetic", "invented-provider-fixture", new AbortController().signal)).toBe("11111111-1111-4111-8111-111111111111");
  expect(fetcher).toHaveBeenCalledOnce(); expect(fetcher.mock.calls[0][0]).toBe("https://api.resend.com/emails");
  expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: "error", headers: { "idempotency-key": "renewal/synthetic" } });
});
it.each([{}, { error: "Synthetic provider error" }, { id: "not-a-receipt" }])("does not treat malformed/provider-error JSON as delivery", async body => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(body))); await expect(sendRenewalEmail({ from: "fixture", to: "fixture", subject: "Synthetic", text: "Synthetic" }, "synthetic", "invented-provider-fixture", new AbortController().signal)).rejects.toThrow();
});
it("bounds a stalled provider request with caller cancellation", async () => {
  const controller = new AbortController(); vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));
  const pending = sendRenewalEmail({ from: "fixture", to: "fixture", subject: "Synthetic", text: "Synthetic" }, "synthetic", "invented-provider-fixture", controller.signal); controller.abort(); await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
