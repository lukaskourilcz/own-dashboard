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
    // The card's cover is the Studio's SVG, which draws the headline too, so the count is on the card buttons.
    const cards = panel.getByRole("button", { name: /typeof null/ });
    await expect(cards).toHaveCount(1);
    // One card per post: typeof null goes out as a story, a post and on Threads, and shows once.
    const instagram = toolbar.getByRole("button", { name: /^Instagram/ });
    const threads = toolbar.getByRole("button", { name: /^Threads/ });
    await instagram.click();
    await expect(instagram).toHaveAttribute("aria-pressed", "false");
    await expect(cards).toHaveCount(1);
    await threads.click();
    await expect(cards).toHaveCount(0);
    await instagram.click();
    await expect(cards).toHaveCount(1);
    await threads.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="publishing-calendar"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/publishing-calendar-${lang}-${info.project.name}.png`, fullPage: true });

    // The dialog previews each version, and switches a version or the whole post off.
    await panel.getByRole("button", { name: /typeof null/ }).click();
    const dialog = page.getByTestId("publishing-post-dialog");
    await expect(dialog.getByRole("heading", { name: "typeof null" })).toBeVisible();
    const tabs = dialog.getByRole("tablist");
    await expect(tabs.getByRole("tab", { name: /Story/ })).toHaveAttribute("aria-selected", "true");
    await expect(dialog.getByTestId("story-frame")).toBeVisible();
    for (const name of [/LinkedIn/, /FB/]) await expect(tabs.getByRole("tab", { name })).toBeDisabled();
    await tabs.getByRole("tab", { name: lang === "cs" ? /Příspěvek/ : /Post/ }).click();
    await expect(dialog.getByTestId("version-caption")).toContainText("what does typeof null return?");
    await tabs.getByRole("tab", { name: /Threads/ }).click();
    await expect(dialog.getByTestId("version-caption")).toContainText("Guess before you swipe");
    await dialog.getByTestId("version-switch").click();
    await expect(dialog.getByTestId("version-switch")).toHaveAttribute("aria-checked", "false");
    await dialog.getByTestId("post-switch").click();
    await expect(dialog.getByTestId("post-switch")).toHaveAttribute("aria-checked", "false");
    await expect(dialog.getByRole("button", { name: lang === "cs" ? "Upravit v Design Labu" : "Edit in Design Lab" })).toBeVisible();
    const dialogScan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="publishing-post-dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(dialogScan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/publishing-dialog-${lang}-${info.project.name}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(panel.getByRole("button", { name: /typeof null/ })).toContainText(lang === "cs" ? "Vypnuto" : "Off");
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
    await expect(panel.getByTestId("backlog-note")).toContainText("Moved the message under the search field.");
    // A note and the hand-over to an agent in one action.
    const item = list.getByRole("listitem").filter({ hasText: "Shorter closing slide on Threads" });
    await item.getByRole("button", { name: lang === "cs" ? "Přidat poznámku" : "Add a note" }).click();
    await item.getByRole("textbox", { name: lang === "cs" ? "Poznámka k úkolu Shorter closing slide on Threads" : "Note for Shorter closing slide on Threads" }).fill("Keep the line short.\nTwo rows at most.");
    await item.getByRole("button", { name: lang === "cs" ? "Uložit a předat agentovi" : "Save and hand to an agent" }).click();
    await expect(item.getByTestId("backlog-note")).toContainText("Two rows at most.");
    await expect(item.getByRole("combobox")).toContainText(lang === "cs" ? "Připraven pro agenta" : "Ready for an agent");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    const scan = await new AxeBuilder({ page: page as unknown as AxePage }).include('[data-testid="backlog-panel"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(scan.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
    await page.screenshot({ path: `test-results/backlog-${lang}-${info.project.name}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
