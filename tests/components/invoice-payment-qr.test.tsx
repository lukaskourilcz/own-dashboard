// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { InvoiceDetail } from "@/components/invoices/invoice-detail";
import { invoices as invoiceFixtures, invoiceItems } from "@/lib/demo/fixtures";
import { invoices } from "@/lib/i18n/sections/invoices";
const state = vi.hoisted(() => ({ lang: "en" as "en" | "cs" }));
vi.mock("@/lib/i18n", () => ({ useDict: () => ({ invoices: invoices[state.lang] }), useLang: () => ({ lang: state.lang }) }));
vi.mock("@/lib/use-now", () => ({ useNow: () => new Date("2026-10-25T00:00:00Z") }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); dispose = undefined; });
function show(patch: Partial<(typeof invoiceFixtures)[number]> = {}, zero = false) {
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host), source = structuredClone(invoiceFixtures[0]);
  const items = structuredClone(invoiceItems.filter(row => row.invoice_id === source.id)).map(row => zero ? { ...row, unit_price: 0 } : row);
  const noop = () => {};
  act(() => root.render(<InvoiceDetail invoice={{ ...source, ...patch }} items={items} logo={null} onBack={noop} onEdit={noop} onDuplicate={noop} onMarkPaid={noop} onMarkUnpaid={noop} onDelete={noop} />));
  dispose = () => { act(() => root.unmount()); host.remove(); }; return host;
}
for (const lang of ["en", "cs"] as const) {
  it(`${lang}: the real detail keeps its valid payment QR`, () => {
    state.lang = lang; const host = show(); expect(host.querySelectorAll(".invoice-print-area svg")).toHaveLength(1); expect(host.textContent).not.toContain(invoices[lang].qrMissing);
  });
  it.each([{ iban: "not-an-account" }, { iban: "CZ6508000000192000145399*AM:999.00" }, { iban: null, bank_account: "1/0100" }, { due_date: "2026-02-29" }, { currency: "CZK*AM:999.00" }])(`${lang}: refuses a malformed stored payment field without changing the document`, patch => {
    state.lang = lang; const before = JSON.stringify(invoiceFixtures[0]), host = show(patch);
    expect(host.querySelectorAll(".invoice-print-area svg")).toHaveLength(0); expect(host.textContent).toContain(invoices[lang].qrMissing); expect(host.querySelector(".invoice-print-area")?.textContent).toContain(invoiceFixtures[0].number); expect(JSON.stringify(invoiceFixtures[0])).toBe(before);
  });
  it(`${lang}: a zero-total document stays readable without an unpayable QR`, () => {
    state.lang = lang; const host = show({}, true); expect(host.querySelectorAll(".invoice-print-area svg")).toHaveLength(0); expect(host.textContent).toContain(invoices[lang].qrMissing);
  });
}
