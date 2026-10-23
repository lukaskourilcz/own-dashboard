import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser, watchConsole } from "./helpers";
import { invoices } from "../src/lib/i18n/sections/invoices";

test("supplier payment terms preserve zero and a failed save keeps the draft", async ({ page }) => {
  const t = invoices.en;
  await gotoPreview(page);
  await signInFixtureUser(page);
  await page.goto("/dev-preview?tab=invoices");
  const writes: Array<{ default_due_days: number }> = [];
  await page.route("**/rest/v1/invoice_settings**", async route => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Synthetic settings failure" }) });
  });
  await page.getByRole("button", { name: t.settings, exact: true }).click();
  await page.getByLabel(t.defaultDueDays, { exact: true }).fill("0");
  await page.getByLabel(t.supplierNameLabel, { exact: true }).fill("Synthetic supplier draft");
  await page.getByRole("button", { name: t.saveSettings, exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  await expect(page.getByRole("button", { name: t.saveSettings, exact: true })).toBeEnabled();
  expect(writes[0].default_due_days).toBe(0);
  await expect(page.getByLabel(t.supplierNameLabel, { exact: true })).toHaveValue("Synthetic supplier draft");
  await expect(page.getByLabel(t.defaultDueDays, { exact: true })).toHaveValue("0");
});

test("editing supplier defaults preserves the unsaved invoice on return", async ({ page }) => {
  const t = invoices.en;
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=invoices");
  await page.getByRole("button", { name: t.newInvoice, exact: true }).click();
  await page.locator("#b-name").fill("Unsaved invoice buyer");
  await page.locator("#i-number").fill("UNSAVED-2026-12");
  await page.getByLabel(t.itemDescriptionPlaceholder, { exact: true }).fill("Unsaved invoice line");
  await page.getByRole("button", { name: t.editSupplier, exact: true }).click();
  await expect(page.getByLabel(t.supplierNameLabel, { exact: true })).toBeVisible();
  await page.getByRole("button", { name: t.back, exact: true }).click();
  await expect(page.locator("#b-name")).toHaveValue("Unsaved invoice buyer");
  await expect(page.locator("#i-number")).toHaveValue("UNSAVED-2026-12");
  await expect(page.getByLabel(t.itemDescriptionPlaceholder, { exact: true })).toHaveValue("Unsaved invoice line");
});

test("invoice list actions and document reflow remain accessible with print isolation", async ({ page }, info) => {
  const t = invoices.en;
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=invoices");
  const errors = watchConsole(page);
  await page.getByRole("button", { name: t.duplicate, exact: true }).focus();
  await expect(page.getByRole("button", { name: t.duplicate, exact: true })).toBeVisible();
  expect(await page.getByRole("button", { name: t.duplicate, exact: true }).evaluate(el => Number(getComputedStyle(el.parentElement!.parentElement!).opacity))).toBe(1);
  await page.getByRole("button", { name: /2026001.*Acme/ }).click();
  for (const width of [360, 390, 768, 1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  expect(axe.violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("invoice-document.png"), fullPage: true });
  await page.emulateMedia({ media: "print" });
  expect(await page.locator(".invoice-print-area").evaluate(el => getComputedStyle(el).visibility)).toBe("visible");
  expect(await page.locator(".no-print").first().evaluate(el => getComputedStyle(el).display)).toBe("none");
  expect(errors).toEqual([]);
});
