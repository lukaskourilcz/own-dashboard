import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/** The publishing calendar and the backlog (owner request, 8 November 2026) on their /dev-preview fixtures. */
for (const lang of ["en", "cs"] as const) {
  test(`Publishing calendar shows three days, filters networks and keeps Facebook and LinkedIn off (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    const calls: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/publishing-calendar")) calls.push(request.url()); });
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.goto("/dev-preview?tab=schedule");
    const panel = page.getByTestId("publishing-calendar");
    await expect(page.getByRole("heading", { level: 1, name: lang === "cs" ? "Kalendář sdílení" : "Publishing calendar" }).first()).toBeVisible();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { level: 2 })).toHaveCount(3);
    const toolbar = panel.getByRole("toolbar");
    for (const name of ["Facebook", "LinkedIn"]) {
      const button = toolbar.getByRole("button", { name: new RegExp(`^${name}`) });
      await expect(button).toBeDisabled();
      await expect(button).toContainText(lang === "cs" ? "Zatím nepropojeno" : "Not connected yet");
    }
    await expect(panel.getByText("typeof null")).toHaveCount(1);
    await expect(panel.getByText("Array holes")).toHaveCount(1);
    const instagram = toolbar.getByRole("button", { name: /^Instagram/ });
    await instagram.click();
    await expect(instagram).toHaveAttribute("aria-pressed", "false");
    await expect(panel.getByText("typeof null")).toHaveCount(0);
    await expect(panel.getByText("Array holes")).toHaveCount(1);
    await instagram.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="publishing-calendar"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/publishing-calendar-${lang}-${info.project.name}.png`, fullPage: true });
    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });

  test(`Backlog filters by project and status and changes a status inline (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.goto("/dev-preview?tab=backlog");
    const panel = page.getByTestId("backlog-panel");
    await expect(page.getByRole("heading", { level: 1, name: "Backlog" }).first()).toBeVisible();
    await expect(panel).toBeVisible();
    const list = panel.getByRole("list", { name: "Backlog" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(panel.getByText("Fix the search error message")).toHaveCount(0);
    await panel.getByRole("combobox", { name: lang === "cs" ? "Stav úkolu Renew the domain" : "Status of Renew the domain" }).click();
    await page.getByRole("option", { name: lang === "cs" ? "Hotový" : "Done", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await panel.getByRole("combobox", { name: lang === "cs" ? "Stav" : "Status", exact: true }).click();
    await page.getByRole("option", { name: lang === "cs" ? "Všechny stavy" : "All statuses", exact: true }).click();
    await expect(list.getByRole("listitem")).toHaveCount(4);
    await expect(panel.getByRole("link", { name: /LDEV-1/ })).toHaveAttribute("href", "https://linka.atlassian.net/browse/LDEV-1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="backlog-panel"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/backlog-${lang}-${info.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
