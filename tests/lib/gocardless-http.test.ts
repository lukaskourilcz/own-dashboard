import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
let gc: typeof import("@/lib/gocardless");
const tx = { transactionId: "synthetic-payment", bookingDate: "2026-10-24", transactionAmount: { amount: "12.34", currency: "CZK" }, remittanceInformationUnstructured: "Synthetic bank payment" };
const token = () => Response.json({ access: "synthetic-inert-fixture", access_expires: 3600 });
beforeEach(async () => { vi.restoreAllMocks(); vi.resetModules(); gc = await import("@/lib/gocardless"); });
it("shares an in-flight token request and bounds every provider request without redirects", async () => {
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).endsWith("/token/new/") ? token()
    : String(url).endsWith("/details/") ? Response.json({ account: { currency: "CZK" } }) : Response.json({ transactions: { booked: [tx], pending: [] } }));
  const [transactions] = await Promise.all([gc.getAccountTransactions("account"), gc.getAccountDetails("account")]);
  expect(transactions.transactions.booked).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/token/new/"))).toHaveLength(1);
  for (const [, init] of fetcher.mock.calls) { expect(init?.redirect).toBe("error"); expect(init?.signal).toBeInstanceOf(AbortSignal); }
});
it("retries a stale authentication response once and discards private provider error bodies", async () => {
  let pulls = 0, tokens = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async url => {
    if (String(url).endsWith("/token/new/")) { tokens++; return token(); }
    return Response.json({ detail: "Synthetic private account detail" }, { status: ++pulls === 1 ? 401 : 502 });
  });
  await expect(gc.getAccountTransactions("account")).rejects.toThrow("Bank provider request failed (502)");
  expect(pulls).toBe(2); expect(tokens).toBe(2);
});
it.each([{ transactions: {} }, { transactions: { booked: [{ ...tx, transactionAmount: { amount: "", currency: "CZK" } }] } }, { transactions: { booked: [{ ...tx, bookingDate: "2026-02-30" }] } }])("refuses malformed booked collections rather than inventing a quiet day (%#)", async payload => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).endsWith("/token/new/") ? token() : Response.json(payload));
  await expect(gc.getAccountTransactions("account")).rejects.toThrow();
});
it("keeps stable bank identities, refuses short fingerprints and preserves Unicode notes", () => {
  expect(gc.mapTransaction(tx)?.external_id).toBe("synthetic-payment");
  expect(gc.mapTransaction({ ...tx, transactionId: undefined })).toBeNull();
  expect(gc.mapTransaction({ ...tx, transactionId: undefined, internalTransactionId: "synthetic-internal" })?.external_id).toBe("synthetic-internal");
  const mapped = gc.mapTransaction({ ...tx, remittanceInformationUnstructured: "🙂".repeat(600) });
  expect([...mapped!.note!]).toHaveLength(500); expect(mapped!.note!.endsWith("🙂")).toBe(true);
});
it("accepts absent optional metadata without losing the evidenced currency or internal identity", async () => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).endsWith("/token/new/") ? token()
    : String(url).endsWith("/details/") ? Response.json({ account: { currency: "CZK", name: null, product: null, ownerName: null } })
      : Response.json({ transactions: { booked: [{ ...tx, transactionId: null, internalTransactionId: "synthetic-internal", creditorName: null }], pending: [] } }));
  expect((await gc.getAccountDetails("account")).account?.currency).toBe("CZK");
  expect(gc.mapTransaction((await gc.getAccountTransactions("account")).transactions.booked[0])?.external_id).toBe("synthetic-internal");
});
it("ends one caller's token wait without cancelling the shared app-token request", async () => {
  const controller = new AbortController(); let release!: () => void;
  const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async url => String(url).endsWith("/token/new/")
    ? new Promise(resolve => { release = () => resolve(token()); }) : Response.json({ transactions: { booked: [tx], pending: [] } }));
  const cancelled = gc.getAccountTransactions("cancelled-account", undefined, controller.signal), refused = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const active = gc.getAccountTransactions("active-account"); controller.abort(); await refused;
  release(); expect((await active).transactions.booked).toHaveLength(1);
  expect(fetcher.mock.calls.filter(([url]) => String(url).endsWith("/token/new/"))).toHaveLength(1);
  expect(fetcher.mock.calls.some(([url]) => String(url).includes("cancelled-account"))).toBe(false);
});
it("passes the enclosing processing deadline to the provider HTTP request", async () => {
  const controller = new AbortController(); let requested!: AbortSignal;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => String(url).endsWith("/token/new/") ? token()
    : new Promise((_resolve, reject) => { requested = init!.signal!; requested.addEventListener("abort", () => reject(requested.reason), { once: true }); }));
  const pending = gc.getAccountTransactions("account", undefined, controller.signal), refused = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(requested).toBeDefined()); controller.abort(); await refused; expect(requested.aborted).toBe(true);
});
