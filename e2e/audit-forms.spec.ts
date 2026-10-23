import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { professional } from "../src/lib/i18n/sections/professional";
import { invoices } from "../src/lib/i18n/sections/invoices";

for (const lang of ["en", "cs"] as const) {
  test(`client form has linked labels and rejects invalid input (${lang})`, async ({ page }) => {
    await gotoPreview(page, { lang });
    await page.goto("/dev-preview?tab=clients");
    const t = professional[lang];
    await page.getByRole("button", { name: t.newClient, exact: true }).click();
    await page.getByLabel(t.name, { exact: true }).fill("Review fixture");
    const email = page.getByLabel(t.email, { exact: true });
    await email.fill("invalid-email");
    const writes: string[] = [];
    page.on("request", request => { if (request.method() === "POST" && request.url().includes("/rest/v1/organizations")) writes.push(request.url()); });
    await page.getByRole("button", { name: t.create, exact: true }).click();
    expect(await email.evaluate(input => (input as HTMLInputElement).validity.typeMismatch)).toBe(true);
    expect(writes).toEqual([]);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });

  test(`invoice line items have unique associated labels (${lang})`, async ({ page }) => {
    await gotoPreview(page, { lang });
    await page.goto("/dev-preview?tab=invoices");
    const errors = watchConsole(page);
    const t = invoices[lang];
    await page.getByRole("button", { name: t.newInvoice, exact: true }).click();
    await page.getByLabel(t.itemQuantity, { exact: true }).fill("2.5");
    await page.getByLabel(t.itemUnitPrice, { exact: true }).fill("100");
    await page.getByRole("button", { name: t.addItem, exact: true }).click();
    await expect(page.getByLabel(t.itemQuantity, { exact: true })).toHaveCount(2);
    await expect(page.getByLabel(t.itemVat, { exact: true })).toHaveCount(2);
    expect(await page.locator("#main-content [id]").evaluateAll(nodes => {
      const ids = nodes.map(node => node.id); return ids.length === new Set(ids).size;
    })).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("#main-content").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
