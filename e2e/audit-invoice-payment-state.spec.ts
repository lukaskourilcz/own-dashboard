import { expect, test } from "@playwright/test";
import { gotoPreview } from "./helpers";
import { invoices as demoInvoices } from "../src/lib/demo/fixtures";
import { invoices } from "../src/lib/i18n/sections/invoices";
import { common } from "../src/lib/i18n/sections/common";

for (const lang of ["en", "cs"] as const) test(`${lang}: payment state retains failures and protects the versioned detail flow`, async ({ page }) => {
  await gotoPreview(page, { lang });
  const t = invoices[lang]; let calls = 0, release: (() => void) | undefined;
  const captured: Array<{ p_expected_updated_at: string; p_paid: boolean; p_paid_on: string | null }> = [];
  await page.route("**/rest/v1/rpc/set_invoice_payment_state", async route => {
    const fields = route.request().postDataJSON(); captured.push(fields);
    if (++calls === 1) {
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ status: 409, json: { code: "40001", message: "Synthetic version conflict" } });
    }
    if (calls === 3) await new Promise<void>(resolve => { release = resolve; });
    return route.fulfill({ json: { invoice: { ...demoInvoices[0], status: fields.p_paid ? "paid" : "issued", paid_on: fields.p_paid_on,
      updated_at: "2026-10-24T00:01:00Z" }, unlinked_transaction_ids: fields.p_paid ? [] : ["synthetic-payment"] } });
  });
  await page.goto("/dev-preview?tab=invoices");
  const paid = page.getByRole("button", { name: `${t.markPaid}: 2026001`, exact: true });
  await paid.click(); await expect.poll(() => !!release).toBe(true);
  await expect(page.getByRole("button", { name: t.newInvoice, exact: true })).toBeDisabled(); release!();
  await expect(page.getByText(t.paymentConflict, { exact: true })).toBeVisible(); await expect(paid).toBeEnabled();
  await paid.click(); await expect(page.getByRole("button", { name: `${t.markUnpaid}: 2026001`, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /^2026001.*Acme/ }).click();
  release = undefined;
  await page.getByRole("button", { name: t.markUnpaid, exact: true }).click(); await expect.poll(() => !!release).toBe(true);
  for (const name of [t.back, t.edit, t.duplicate, t.print]) await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
  release!(); await expect(page.getByRole("button", { name: t.markPaid, exact: true })).toBeEnabled();
  // The preview module's clock belongs to the app process, not this worker.
  expect(captured[0].p_expected_updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(captured[1].p_expected_updated_at).toBe(captured[0].p_expected_updated_at);
  expect(captured[2].p_expected_updated_at).toBe("2026-10-24T00:01:00Z");
  expect(captured.map(call => call.p_paid)).toEqual([true, true, false]);
});

test("failed invoice deletion restores the detail and preserves the captured version", async ({ page }) => {
  await gotoPreview(page); const t = invoices.en;
  const confirmedAt = "2026-10-24T01:00:00Z";
  await page.route("**/rest/v1/rpc/set_invoice_payment_state", route => route.fulfill({ json: {
    invoice: { ...demoInvoices[0], status: "paid", paid_on: route.request().postDataJSON().p_paid_on, updated_at: confirmedAt }, unlinked_transaction_ids: [],
  } }));
  let version: string | null = null;
  await page.route("**/rest/v1/invoices?**", async route => {
    expect(route.request().method()).toBe("DELETE"); version = new URL(route.request().url()).searchParams.get("updated_at");
    await route.fulfill({ status: 500, json: { message: "Synthetic deletion failure" } });
  });
  await page.goto("/dev-preview?tab=invoices");
  await page.getByRole("button", { name: `${t.markPaid}: 2026001`, exact: true }).click();
  await expect(page.getByRole("button", { name: `${t.markUnpaid}: 2026001`, exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /^2026001.*Acme/ }).click();
  await page.getByRole("button", { name: t.delete, exact: true }).click();
  await page.getByRole("dialog", { name: common.en.delete, exact: true }).getByRole("button", { name: common.en.delete, exact: true }).click();
  await expect(page.getByRole("button", { name: t.edit, exact: true })).toBeEnabled();
  await expect(page.getByText(t.deleteErr, { exact: true })).toBeVisible();
  expect(version).toBe(`eq.${confirmedAt}`);
});
