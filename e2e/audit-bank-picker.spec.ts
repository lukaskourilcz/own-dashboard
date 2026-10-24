import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser, integrationStatusFixture } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
import { common } from "../src/lib/i18n/sections/common";

const providers: Parameters<typeof integrationStatusFixture>[0] = [
  { id: "gocardless", label: "GoCardless", configured: true, connected: false, supportsInstitutionPicker: true },
  { id: "fio", label: "Fio banka", configured: true, connected: true, supportsInstitutionPicker: false },
];
for (const lang of ["en", "cs"] as const) {
  const copy = finances[lang].bank;
  test(`${lang}: retrying credential status never submits the typed token`, async ({ page }) => {
    await gotoPreview(page, { lang }); await signInFixtureUser(page);
    await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture(providers) }));
    let reads = 0, stores = 0, syncs = 0, recovered = false;
    await page.route("**/api/bank/credentials", route => {
      if (route.request().method() !== "GET") { stores++; return route.fulfill({ status: 503, json: {} }); }
      reads++; return !recovered ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { stored: { fio: false } } });
    });
    await page.route("**/api/bank/sync", route => { syncs++; return route.fulfill({ status: 503, json: {} }); });
    await page.goto("/dev-preview?tab=accounts");
    await page.getByTestId("bank-sync").getByRole("button", { name: copy.connect, exact: true }).click();
    await page.getByRole("button", { name: "Fio banka", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Fio banka", exact: true }), input = dialog.getByLabel(copy.fioTitle, { exact: true });
    await expect(dialog.getByRole("alert")).toContainText(copy.credentialsLoadErr);
    await input.fill("synthetic-test-value-not-a-credential");
    const previousReads = reads; recovered = true;
    await dialog.getByRole("button", { name: common[lang].retry, exact: true }).click();
    await expect.poll(() => reads).toBeGreaterThan(previousReads); await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(input).toHaveValue("synthetic-test-value-not-a-credential"); expect(stores).toBe(0); expect(syncs).toBe(0);
  });
  test(`${lang}: bank picker recovers from failures and prevents navigation during connection`, async ({ page }) => {
    await gotoPreview(page, { lang }); await signInFixtureUser(page);
    await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture(providers) }));
    let lists = 0;
    await page.route("**/api/bank/institutions?**", route => ++lists === 1 ? route.fulfill({ status: 502, json: {} }) : route.fulfill({ json: { institutions: [{ id: "SYNTHETIC_BANK", name: "Synthetic bank", bic: null, logo: null }] } }));
    let release!: () => void, connects = 0;
    await page.route("**/api/bank/connect", async route => {
      if (++connects === 2) return route.fulfill({ status: 503, json: {} });
      await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { link: "javascript:alert(1)" } });
    });
    await page.goto("/dev-preview?tab=accounts");
    await page.getByTestId("bank-sync").getByRole("button", { name: copy.connect, exact: true }).click();
    await page.getByRole("button", { name: "GoCardless", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: copy.pickBank, exact: true });
    await expect(dialog.getByRole("alert")).toContainText(copy.loadBanksErr);
    await dialog.getByRole("button", { name: common[lang].retry, exact: true }).click();
    await dialog.getByRole("textbox", { name: copy.searchBank, exact: true }).fill("Synthetic");
    await dialog.getByRole("button", { name: "Synthetic bank", exact: true }).click();
    await expect.poll(() => !!release).toBe(true);
    await expect(dialog.getByRole("button", { name: copy.providerBack, exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); release();
    await expect(dialog.getByRole("alert")).toContainText(copy.connectErr);
    await expect(dialog.getByRole("button", { name: "Synthetic bank", exact: true })).toBeEnabled();
    expect(connects).toBe(1); expect(page.url()).toContain("/dev-preview?tab=accounts");
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: "Synthetic bank", exact: true }).click();
    await expect(dialog.getByText(copy.notConfigured, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: copy.providerBack, exact: true })).toBeEnabled();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
  });

  test(`${lang}: token storage and a failed first sync have separate receipts and retry`, async ({ page }) => {
    await gotoPreview(page, { lang, theme: "dark" }); await signInFixtureUser(page);
    await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture(providers) }));
    let stores = 0, syncs = 0, release!: () => void;
    await page.route("**/api/bank/credentials", async route => {
      if (route.request().method() === "GET") return route.fulfill({ json: { stored: { fio: false } } });
      stores++; await new Promise<void>(resolve => { release = resolve; });
      await route.fulfill({ json: { ok: true, connectionId: "11111111-1111-4111-8111-111111111111" } });
    });
    await page.route("**/api/bank/sync", route => ++syncs === 1 ? route.fulfill({ status: 502, json: {} }) : route.fulfill({ json: { inserted: 0 } }));
    await page.goto("/dev-preview?tab=accounts");
    await page.getByTestId("bank-sync").getByRole("button", { name: copy.connect, exact: true }).click();
    await page.getByRole("button", { name: "Fio banka", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Fio banka", exact: true }), input = dialog.getByLabel(copy.fioTitle, { exact: true });
    await input.fill("synthetic-test-value-not-a-credential");
    await dialog.getByRole("button", { name: copy.fioSave, exact: true }).click(); await expect.poll(() => !!release).toBe(true);
    await expect(input).toBeDisabled(); await expect(dialog.getByRole("button", { name: copy.providerBack, exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toBeVisible(); release();
    await expect(dialog.getByRole("alert")).toHaveText(copy.fioSyncErr); await expect(input).toHaveValue("");
    await expect(dialog.getByRole("status")).toHaveText(copy.fioStored);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
    await dialog.getByRole("button", { name: copy.syncNow, exact: true }).click(); await expect(dialog).toHaveCount(0);
    expect(stores).toBe(1); expect(syncs).toBe(2);
  });
}
