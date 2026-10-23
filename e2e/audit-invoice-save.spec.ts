import { expect, test } from "@playwright/test";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { invoices } from "../src/lib/i18n/sections/invoices";

for (const lang of ["en", "cs"] as const) {
  test(`invoice validation retains zero and reuses the save identity after failure (${lang})`, async ({ page }) => {
    const t = invoices[lang];
    await gotoPreview(page, { lang });
    await signInFixtureUser(page);
    await page.goto("/dev-preview?tab=invoices");
    const requests: Array<{ p_id: string; p_items: Array<{ quantity: number; unit_price: number }> }> = [];
    await page.route("**/rest/v1/rpc/save_invoice_document", async route => {
      requests.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ code: "XX000", message: "Synthetic storage failure" }) });
    });
    await page.getByRole("button", { name: t.newInvoice, exact: true }).click();
    await page.locator("#b-name").fill("Synthetic buyer");
    await page.getByLabel(t.itemDescriptionPlaceholder, { exact: true }).fill("Synthetic work");
    const quantity = page.getByLabel(t.itemQuantity, { exact: true });
    await quantity.fill("-1");
    await page.getByLabel(t.itemUnitPrice, { exact: true }).fill("120.50");
    await page.getByRole("button", { name: t.saveDraft, exact: true }).click();
    expect(await quantity.evaluate(input => (input as HTMLInputElement).validity.rangeUnderflow)).toBe(true);
    expect(requests).toEqual([]);
    await quantity.fill("0");
    await page.getByRole("button", { name: t.saveDraft, exact: true }).click();
    await expect(page.getByText(t.errorToast, { exact: true })).toBeVisible();
    await expect(page.locator("#b-name")).toHaveValue("Synthetic buyer");
    await expect(quantity).toHaveValue("0");
    await page.getByRole("button", { name: t.saveDraft, exact: true }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[0].p_id).toBe(requests[1].p_id);
    expect(requests[0].p_items).toMatchObject([{ quantity: 0, unit_price: 120.5 }]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
