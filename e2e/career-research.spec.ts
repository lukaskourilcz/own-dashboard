import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

test("Czech research grid opens complete research, protects edits and has keyboard-safe dialogs", async ({
  page,
}, info) => {
  await gotoPreview(page, { lang: "cs" });
  await page.goto("/dev-preview?tab=career");
  const grid = page.getByTestId("career-job-grid");
  await expect(grid).toBeVisible();
  await expect(
    grid.getByRole("button", { name: /Momence.*92%/ }),
  ).toBeVisible();
  await grid.getByRole("button", { name: /Momence.*92%/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Full-stack Engineer (React/Node)",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("link", { name: /Otevřít původní nabídku/ }),
  ).toHaveAttribute("href", /^https:\/\//);
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
    grid.getByRole("button", { name: /Momence.*92%/ }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/career-grid-${info.project.name}.png`,
    fullPage: true,
  });
});

test("Career links list Czech employers and Settings has no market opt-in", async ({
  page,
}) => {
  await gotoPreview(page, { lang: "cs" });
  await page.goto("/dev-preview?tab=career");
  await page
    .getByRole("button", { name: "Kariérní odkazy", exact: true })
    .click();
  for (const name of ["Productboard", "STRV", "Apify"])
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Flowcase", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("combobox", { name: "Město" }).click();
  await page.getByRole("option", { name: "Brno", exact: true }).click();
  await expect(page.getByRole("link", { name: "Productboard", exact: true })).toHaveCount(0);
  await page.goto("/dev-preview?tab=settings");
  await expect(
    page.getByRole("checkbox", { name: "Zobrazit český obsah Kariéry" }),
  ).toHaveCount(0);
});

test("Research filters narrow to remote and B2B roles and recover from no results", async ({
  page,
}) => {
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=career");
  const grid = page.getByTestId("career-job-grid");
  await page.getByRole("combobox", { name: "Opportunity filter" }).click();
  await page.getByRole("option", { name: "B2B and contracts" }).click();
  await expect(grid.getByRole("button", { name: /Nexer.*Frontend Developer/ })).toBeVisible();
  await page.getByRole("textbox", { name: "Search positions" }).fill("zzzz-no-such-role");
  await expect(page.getByRole("status").filter({ hasText: "No roles match this filter." })).toBeVisible();
  await page.getByRole("button", { name: "Show all roles" }).click();
  await expect(grid.getByRole("button", { name: /Momence.*92%/ })).toBeVisible();
});

test("Czech research reflows at six widths in both themes", async ({
  page,
}, info) => {
  test.skip(info.project.name !== "desktop", "run the width matrix once");
  for (const theme of ["light", "dark"] as const)
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      await gotoPreview(page, { lang: theme === "light" ? "cs" : "en", theme });
      await page.goto("/dev-preview?tab=career");
      await expect(page.getByTestId("career-job-grid")).toBeVisible();
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
        path: `test-results/career-${theme}-${width}.png`,
        fullPage: true,
      });
    }
});
