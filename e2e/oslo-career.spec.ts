import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

test("Oslo grid opens complete research, protects edits and has keyboard-safe dialogs", async ({
  page,
}, info) => {
  await gotoPreview(page, { lang: "cs" });
  await page.goto("/dev-preview?tab=career");
  const grid = page.getByTestId("oslo-job-grid");
  await expect(grid).toBeVisible();
  await expect(
    grid.getByRole("button", { name: /Flowcase.*88%/ }),
  ).toBeVisible();
  await grid.getByRole("button", { name: /Flowcase.*88%/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Senior Frontend Engineer",
      exact: true,
    }),
  ).toBeVisible();
  await expect(dialog.getByText(/React Aria/)).toBeVisible();
  await expect(dialog.getByLabel("Text průvodního dopisu")).toBeVisible();
  expect(
    (
      await new AxeBuilder({
        page: page as unknown as ConstructorParameters<
          typeof AxeBuilder
        >[0]["page"],
      })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog
    .getByLabel("Text průvodního dopisu")
    .fill("Preview-only edited draft.");
  await page.keyboard.press("Escape");
  const confirmation = page.getByRole("dialog", {
    name: "Zahodit neuložené úpravy?",
  });
  await expect(confirmation).toBeVisible();
  await confirmation
    .getByRole("button", { name: "Pokračovat v úpravách" })
    .click();
  await expect(dialog.getByLabel("Text průvodního dopisu")).toHaveValue(
    "Preview-only edited draft.",
  );
  await page.keyboard.press("Escape");
  await page
    .getByRole("dialog", { name: "Zahodit neuložené úpravy?" })
    .getByRole("button", { name: "Zahodit úpravy", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(
    grid.getByRole("button", { name: /Flowcase.*88%/ }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/oslo-grid-${info.project.name}.png`,
    fullPage: true,
  });
});

test("Czech contents are off by default and the settings checkbox restores the archive", async ({
  page,
}) => {
  await gotoPreview(page, { lang: "cs" });
  await page.goto("/dev-preview?tab=career");
  await page
    .getByRole("button", { name: "Kariérní odkazy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "Flowcase", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "STRV", exact: true }),
  ).toHaveCount(0);
  await page.goto("/dev-preview?tab=settings");
  const toggle = page.getByRole("checkbox", {
    name: "Zobrazit český obsah Kariéry",
    exact: true,
  });
  await expect(toggle).not.toBeChecked();
  await toggle.check();
  await expect(toggle).toBeChecked();
  await page.goto("/dev-preview?tab=career");
  await page
    .getByRole("button", { name: "Kariérní odkazy", exact: true })
    .click();
  await expect(
    page.getByRole("link", { name: "STRV", exact: true }),
  ).toBeVisible();
});

test("Oslo research reflows at six widths in both themes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "run the width matrix once");
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      await gotoPreview(page, { lang: theme === "light" ? "cs" : "en", theme });
      await page.goto("/dev-preview?tab=career");
      await expect(page.getByTestId("oslo-job-grid")).toBeVisible();
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        ),
        `${theme} ${width}`,
      ).toBeLessThanOrEqual(1);
      expect(
        (
          await new AxeBuilder({
            page: page as unknown as ConstructorParameters<
              typeof AxeBuilder
            >[0]["page"],
          })
            .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
            .analyze()
        ).violations,
        `${theme} ${width}`,
      ).toEqual([]);
      await page.screenshot({
        path: `test-results/oslo-${theme}-${width}.png`,
        fullPage: true,
      });
    }
});
