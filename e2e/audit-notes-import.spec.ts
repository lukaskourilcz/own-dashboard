import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { notes } from "../src/lib/i18n/sections/notes";

for (const lang of ["en", "cs"] as const) {
  test(`failed Markdown import keeps its input and never reports success (${lang})`, async ({ page }) => {
    const t = notes[lang];
    await gotoPreview(page, { lang });
    await signInFixtureUser(page);
    await page.goto("/dev-preview?tab=notes");
    let writes = 0;
    await page.route("**/rest/v1/notes**", async route => {
      if (route.request().method() === "POST") writes++;
      await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic import failure" }) });
    });
    await page.getByRole("button", { name: t.importMd, exact: true }).click();
    const dialog = page.getByRole("dialog");
    const input = dialog.getByRole("textbox", { name: t.importFromMarkdown, exact: true });
    await input.fill("# Keep this draft\n\nThe backend is temporarily unavailable.");
    await dialog.getByRole("button", { name: t.createNote, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t.couldNotCreateNote);
    await expect(input).toHaveValue("# Keep this draft\n\nThe backend is temporarily unavailable.");
    await expect(page.getByText(t.importedAsNewNote, { exact: true })).toHaveCount(0);
    expect(writes).toBe(1);
    await dialog.getByRole("button", { name: t.createNote, exact: true }).click();
    await expect.poll(() => writes).toBe(2);
    await expect(dialog).toBeVisible();
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);
  });
}
