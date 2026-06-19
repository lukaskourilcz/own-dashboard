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

    // No horizontal overflow on a 393px-wide device.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
