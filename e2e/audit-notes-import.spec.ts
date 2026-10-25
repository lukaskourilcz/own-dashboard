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

for (const lang of ['en', 'cs'] as const) test(`${lang}: a different verified login cannot import into the original preview owner`, async ({ page }) => {
 const t = notes[lang], other = '22222222-2222-4222-8222-222222222222';
 await gotoPreview(page, { lang }); await signInFixtureUser(page, other);
 await page.route('**/auth/v1/user', route => route.fulfill({ json: { id: other, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-10-25T12:00:00Z' } }));
 let writes = 0;
 await page.route('**/rest/v1/notes**', route => { if (route.request().method() === 'POST') writes++; return route.fulfill({ status: 500, json: { message: 'This synthetic write must not happen' } }); });
 await page.goto('/dev-preview?tab=notes'); await page.getByRole('button', { name: t.importMd, exact: true }).click(); const dialog = page.getByRole('dialog');
 const input = dialog.getByRole('textbox', { name: t.importFromMarkdown, exact: true }); const text = '# Keep the original owner\n\nSynthetic private import.'; await input.fill(text); await dialog.getByRole('button', { name: t.createNote, exact: true }).click();
 await expect(dialog.getByRole('alert')).toHaveText(t.couldNotCreateNote); await expect(input).toHaveValue(text); expect(writes).toBe(0); await expect(page.getByText(t.importedAsNewNote, { exact: true })).toHaveCount(0);
});
