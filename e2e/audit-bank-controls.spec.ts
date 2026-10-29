import { user as demoUser } from "../src/lib/demo/fixtures";
import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { integrationStatusFixture, gotoPreview, signInFixtureUser } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

for (const lang of ["en", "cs"] as const) {
  const copy = finances[lang].bank;
  test(`${lang}: bank actions protect pending work and retain failed connections`, async ({ page }, info) => {
    await gotoPreview(page, { lang }); await signInFixtureUser(page);
    const names = ["Synthetic Bank A", "Synthetic Bank B"];
    let rows = names.map((name, index) => ({ id: `11111111-0000-4000-8000-${String(index).padStart(12, "0")}`, user_id: demoUser.id, institution_name: name,
      provider: "gocardless", status: "linked", last_error: index === 1 ? "Synthetic private legacy detail" : null, last_synced_at: null, consent_expires_at: null }));
    await page.route("**/rest/v1/bank_connections**", route => route.fulfill({ json: rows, headers: { "access-control-expose-headers": "content-range", "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" } }));
    await page.route("**/api/integrations/status", route => route.fulfill({ json: integrationStatusFixture([{ id: "gocardless", label: "GoCardless", configured: true, connected: true, supportsInstitutionPicker: true }]) }));
    let release!: () => void, syncs = 0, disconnects = 0;
    await page.route("**/api/bank/sync", async route => {
      if (++syncs === 1) { await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ status: 502, json: { error: "Synthetic failed pull" } }); }
      return route.fulfill({ json: { inserted: 2, banks: 1, accounts: 1 } });
    });
    await page.route("**/api/bank/disconnect", async route => {
      if (++disconnects === 1) return route.fulfill({ status: 500, json: {} });
      rows = rows.slice(1); return route.fulfill({ json: { ok: true, upstreamRevoked: false } });
    });
    await page.goto("/dev-preview?tab=transactions"); await page.getByText(finances[lang].importAndMatch, { exact: true }).click();
    const bank = page.getByTestId("bank-sync"), sync = bank.getByRole("button", { name: `${copy.syncThis}: ${names[0]}`, exact: true });
    await expect(bank.getByText("Synthetic private legacy detail")).toHaveCount(0);
    const disconnect = bank.getByRole("button", { name: `${copy.disconnect}: ${names[0]}`, exact: true });
    await expect(disconnect).toBeVisible(); if (info.project.name === "mobile") expect((await disconnect.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await sync.click(); await expect.poll(() => !!release).toBe(true);
    for (const name of names) {
      await expect(bank.getByRole("button", { name: `${copy.syncThis}: ${name}`, exact: true })).toBeDisabled();
      await expect(bank.getByRole("button", { name: `${copy.disconnect}: ${name}`, exact: true })).toBeDisabled();
    }
    await expect(bank.getByRole("button", { name: copy.connect, exact: true })).toBeDisabled(); release();
    await expect(bank.getByRole("alert").filter({ hasText: copy.syncErr })).toBeVisible();
    await sync.click(); await expect(page.getByText(copy.syncDone(2), { exact: true })).toBeVisible();
    await disconnect.click(); await page.getByRole("dialog", { name: copy.disconnect, exact: true }).getByRole("button", { name: copy.disconnect, exact: true }).click();
    await expect(bank.getByRole("alert")).toHaveText(copy.disconnectErr); await expect(disconnect).toBeVisible();
    await disconnect.click(); await page.getByRole("dialog", { name: copy.disconnect, exact: true }).getByRole("button", { name: copy.disconnect, exact: true }).click();
    await expect(bank.getByRole("alert")).toHaveText(copy.revokeUnconfirmed); await expect(disconnect).toHaveCount(0);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
      if (width >= 1024) {
        const a = (await bank.boundingBox())!, b = (await page.getByTestId("payment-matches").boundingBox())!;
        expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(1); expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);
      }
      if (lang === "cs" && (width === 360 || width === 1440)) await bank.screenshot({ path: `/tmp/app-audit-bank-controls-cs-${width}.png` });
    }
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="bank-sync"]').withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  });

  test(`${lang}: failed bank metadata exposes retry without hiding CSV`, async ({ page }) => {
    await gotoPreview(page, { lang, theme: "dark" }); await signInFixtureUser(page);
    let failed = true;
    await page.route("**/rest/v1/bank_connections**", route => route.fulfill({ status: failed ? 503 : 200, json: failed ? {} : [], headers: { "access-control-expose-headers": "content-range", "content-range": "*/0" } }));
    await page.goto("/dev-preview?tab=accounts");
    const bank = page.getByTestId("bank-sync");
    await expect(bank.getByRole("alert")).toContainText(copy.connectionsLoadErr); await expect(bank.getByRole("button", { name: copy.chooseFile, exact: true })).toBeVisible();
    failed = false; await bank.getByRole("button", { name: lang === "cs" ? "Zkusit znovu" : "Try again", exact: true }).click();
    await expect(bank.getByRole("alert")).toHaveCount(0);
  });
}
