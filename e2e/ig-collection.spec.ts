import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

/** IG Kolekce (owner request, 9 November 2026) on its /dev-preview fixture: no API call, no processing. */
for (const lang of ["en", "cs"] as const) {
  test(`IG Kolekce lists saved posts, filters them and asks before processing (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    const calls: string[] = [];
    page.on("request", (request) => { if (request.url().includes("/api/marketing/collection") || request.url().includes("/api/marketing/knowledge")) calls.push(request.url()); });
    await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.goto("/dev-preview?tab=ig-collection");
    const panel = page.getByTestId("ig-collection-panel");
    await expect(page.getByRole("heading", { level: 1, name: lang === "cs" ? "IG Kolekce" : "IG Collection" }).first()).toBeVisible();
    await expect(panel.getByTestId("ig-collection-header")).toContainText(lang === "cs" ? "1 už v IG TIPS" : "1 already in IG TIPS");
    await expect(panel.getByTestId("ig-collection-header")).toContainText(lang === "cs" ? "5 příspěvků" : "5 posts");
    await expect(panel.getByTestId("ig-collection-post")).toHaveCount(5);
    await expect(panel.getByText("reelcraft.studio")).toBeVisible();
    await expect(panel.getByText(lang === "cs" ? "Už v IG TIPS" : "Already in IG TIPS", { exact: true }).first()).toBeVisible();

    // Search and the status filter narrow the list.
    await panel.getByRole("searchbox").fill("hook");
    await expect(panel.getByTestId("ig-collection-post")).toHaveCount(1);
    await panel.getByRole("searchbox").fill("");
    await panel.getByRole("combobox", { name: lang === "cs" ? "Stav" : "Status" }).click();
    await page.getByRole("option", { name: lang === "cs" ? "Nepřístupný" : "Restricted" }).click();
    await expect(panel.getByTestId("ig-collection-post")).toHaveCount(1);
    await expect(panel.getByText(lang === "cs" ? "Instagram tenhle příspěvek veřejně neukazuje." : "Instagram does not show this post publicly.")).toBeVisible();
    await panel.getByRole("combobox", { name: lang === "cs" ? "Stav" : "Status" }).click();
    await page.getByRole("option", { name: lang === "cs" ? "Vše" : "All" }).first().click();
    await expect(panel.getByTestId("ig-collection-post")).toHaveCount(5);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="ig-collection-panel"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/ig-collection-${lang}-${info.project.name}.png`, fullPage: true });

    // Process queued opens the consent dialog; Start stays disabled until the owner approves.
    await panel.getByRole("button", { name: lang === "cs" ? "Zpracovat frontu (1)" : "Process queued (1)" }).click();
    const dialog = page.getByTestId("ig-collection-consent");
    await expect(dialog).toContainText("$0.05");
    const start = dialog.getByRole("button", { name: lang === "cs" ? "Spustit" : "Start" });
    await expect(start).toBeDisabled();
    await dialog.getByRole("checkbox").click();
    await expect(start).toBeEnabled();
    await start.click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByRole("status").filter({ hasText: lang === "cs" ? "Ukázková data" : "Preview data" }).first()).toBeVisible();

    // Help carries the Shortcut steps.
    await panel.getByText(lang === "cs" ? "Jak to funguje" : "How it works").click();
    await expect(panel.getByTestId("ig-collection-help")).toContainText("Authorization");

    expect(calls).toEqual([]);
    expect(errors).toEqual([]);
  });
}
