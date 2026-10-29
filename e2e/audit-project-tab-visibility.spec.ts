import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { professional } from "../src/lib/i18n/sections/professional";
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: workspace deep links and resized strips keep the selected tab visible without moving focus or the page`, async ({ page }) => {
    const errors = watchConsole(page), t = professional[lang]; await page.setViewportSize({ width: 360, height: 1000 }); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
    await page.goto("/dev-preview?project=own-dashboard&projectTab=monetization");
    const list = page.getByRole("tablist", { name: t.projectWorkspace, exact: true });
    const visible = () => list.evaluate(element => {
      const selected = element.querySelector<HTMLElement>('[aria-selected="true"]')!, item = selected.getBoundingClientRect(), viewport = element.getBoundingClientRect();
      return item.left >= viewport.left - 1 && item.right <= viewport.right + 1;
    });
    await expect(list.getByRole("tab", { selected: true })).toHaveText(t.projectMonetization); await expect.poll(visible).toBe(true);
    for (const width of [360, 430, 768, 1024, 1440, 1728, 360]) {
      await page.setViewportSize({ width, height: 1000 }); await expect.poll(visible).toBe(true); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    }
    const panel = page.getByRole("tabpanel"); await panel.evaluate(element => element.focus({ preventScroll: true })); await expect(panel).toBeFocused();
    const scroll = await page.evaluate(() => ({ page: scrollY, main: document.querySelector("main")!.scrollTop, content: document.querySelector(".mac-content-scroll")!.scrollTop }));
    await page.evaluate(() => { const url = new URL(location.href); url.searchParams.set("projectTab", "knowledge"); history.replaceState(history.state, "", url); dispatchEvent(new Event("project-tab")); });
    await expect(list.getByRole("tab", { selected: true })).toHaveText(t.projectKnowledge); await expect.poll(visible).toBe(true); await expect(panel).toBeFocused();
    expect(await page.evaluate(() => ({ page: scrollY, main: document.querySelector("main")!.scrollTop, content: document.querySelector(".mac-content-scroll")!.scrollTop }))).toEqual(scroll);
    // Manual keyboard focus remains independent of selection.
    await list.getByRole("tab", { selected: true }).focus(); await page.keyboard.press("Home"); await expect(list.getByRole("tab").first()).toBeFocused();
    await expect(list.getByRole("tab", { selected: true })).toHaveText(t.projectKnowledge); await page.keyboard.press("End"); await expect(list.getByRole("tab").last()).toBeFocused(); await page.keyboard.press("Enter");
    await expect(list.getByRole("tab", { selected: true })).toHaveText(t.projectMonetization); await expect.poll(visible).toBe(true);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="tablist"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]); expect(errors).toEqual([]);
  });
}
