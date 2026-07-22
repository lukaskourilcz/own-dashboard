import { test, expect } from "@playwright/test";
import { gotoPreview } from "./helpers";

test.describe("responsive chrome", () => {
  test("desktop: sidebar visible, mobile FAB hidden", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "desktop-only assertion");
    await gotoPreview(page);
    await expect(page.locator("aside")).toBeVisible();
    await expect(page.getByTestId("mobile-nav")).toBeHidden();
    await expect(page.getByRole("button", { name: "Quick add" })).toBeHidden();
  });

  test("mobile: bottom nav + FAB visible, sidebar hidden", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
    await gotoPreview(page);
    await expect(page.locator("aside")).toBeHidden();
    await expect(page.getByTestId("mobile-nav")).toBeVisible();
    await expect(page.getByRole("button", { name: "Quick add" })).toBeVisible();

    const navBox = await page.getByTestId("mobile-nav").boundingBox();
    const fabBox = await page.getByRole("button", { name: "Quick add" }).boundingBox();
    expect(navBox).not.toBeNull();
    expect(fabBox).not.toBeNull();
    expect(fabBox!.y + fabBox!.height).toBeLessThanOrEqual(navBox!.y);

    // No horizontal overflow on a 393px-wide device.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test("mobile More keeps every destination reachable", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
    await gotoPreview(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "All areas" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Opportunities", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Opportunities", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { level: 1, name: "Opportunities" })).toBeVisible();
  });

  test("mobile Career keeps the data table inside its own scroller", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile", "mobile-only assertion");
    await gotoPreview(page);
    await page.getByRole("button", { name: "More", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "All areas" });
    await dialog.getByRole("button", { name: "Career", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Career" })).toBeVisible();
    const overflow = await page.evaluate(
      () => document.body.scrollWidth - document.body.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByRole("columnheader", { name: "Match" })).toBeAttached();
  });

  test("representative widths reflow without page overflow", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "run the width matrix once");
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: width < 768 ? 844 : 1000 });
      await gotoPreview(page, { lang: width === 360 ? "cs" : "en", theme: width === 1024 ? "dark" : "light" });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `overflow at ${width}px`).toBeLessThanOrEqual(1);
      if (width < 768) {
        await expect(page.getByTestId("mobile-nav")).toBeVisible();
        await expect(page.locator("aside")).toBeHidden();
      } else {
        await expect(page.getByTestId("mobile-nav")).toBeHidden();
        await expect(page.locator("aside")).toBeVisible();
      }
    }
  });
});
