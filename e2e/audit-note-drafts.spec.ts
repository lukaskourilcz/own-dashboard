import { expect, test, type Page } from "@playwright/test";
import { gotoPreview } from "./helpers";
import { notes } from "../src/lib/i18n/sections/notes";
import { common } from "../src/lib/i18n/sections/common";
import { nav } from "../src/lib/i18n/sections/nav";

async function home(page: Page, name: string) {
  const mobile = page.getByTestId("mobile-nav");
  if (await mobile.isVisible()) await mobile.getByRole("button", { name, exact: true }).click();
  else await page.locator("aside").getByRole("button", { name, exact: true }).click();
}

test("a failed pin change cannot replace a successfully saved document", async ({ page }, info) => {
  const t = notes.en;
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=notes");
  if (info.project.name === "mobile") await page.getByRole("button", { name: /Project ideas/ }).click();
  let releasePin: (() => Promise<void>) | undefined;
  await page.route("**/rest/v1/notes**", async route => {
    const fields = route.request().postDataJSON();
    if ("is_pinned" in fields) {
      await new Promise<void>(resolve => { releasePin = async () => {
        await route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Synthetic pin failure"}' }); resolve();
      }; });
    } else await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "n1", user_id: "u1", is_pinned: false, tags: ["work", "ideas"], sort_order: 2, created_at: "2026-10-23T10:00:00Z", updated_at: "2026-10-23T12:00:00Z", ...fields }) });
  });
  await page.getByRole("button", { name: t.unpin, exact: true }).click();
  await expect.poll(() => !!releasePin).toBe(true);
  const editor = page.getByRole("textbox", { name: t.editorLabel, exact: true });
  await editor.fill("Confirmed document after pin request");
  await expect(page.getByText(t.unsavedChanges, { exact: true })).toHaveCount(0);
  await expect(page.getByText(t.saving, { exact: true })).toHaveCount(0);
  // Wait for the confirmed header title before releasing the older failure.
  await expect(page.locator("[data-note-editor-title]")).toHaveText("Confirmed document after pin request");
  await releasePin!();
  await expect(page.getByRole("button", { name: t.unpin, exact: true })).toBeEnabled();
  if (info.project.name === "mobile") await page.getByRole("button", { name: t.back, exact: true }).click();
  await page.getByRole("button", { name: /Release checklist/ }).click();
  if (info.project.name === "mobile") await page.getByRole("button", { name: t.back, exact: true }).click();
  // The failed optimistic pin moves the row between lists; wait for the old
  // AnimatePresence row to finish leaving before selecting the retained one.
  const retained = page.getByRole("button", { name: /Confirmed document after pin request/ });
  await expect(retained).toHaveCount(1);
  await retained.click();
  await expect(editor).toHaveText("Confirmed document after pin request");
});

test("opening and leaving a note without edits performs no write or draft prompt", async ({ page }, info) => {
  await gotoPreview(page);
  let writes = 0;
  page.on("request", request => { if (request.method() === "PATCH" && request.url().includes("/rest/v1/notes")) writes++; });
  await page.goto("/dev-preview?tab=notes");
  if (info.project.name === "mobile") await page.getByRole("button", { name: /Project ideas/ }).click();
  await expect(page.getByRole("textbox", { name: notes.en.editorLabel, exact: true })).toBeVisible();
  // Cross the actual 600 ms editor debounce so mount-only writes cannot hide.
  await page.waitForTimeout(700);
  await home(page, nav.en.sections.home);
  await expect(page.getByRole("dialog", { name: common.en.unsaved.title, exact: true })).toHaveCount(0);
  expect(writes).toBe(0);
});

for (const lang of ["en", "cs"] as const) {
  test(`failed drafts survive switching notes and remain protected when leaving (${lang})`, async ({ page }, info) => {
    const t = notes[lang], guard = common[lang].unsaved;
    await gotoPreview(page, { lang });
    await page.route("**/rest/v1/notes**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Synthetic save failure"}' }));
    await page.goto("/dev-preview?tab=notes");
    const mobile = info.project.name === "mobile";
    if (mobile) await page.getByRole("button", { name: /Project ideas/ }).click();
    const editor = page.getByRole("textbox", { name: t.editorLabel, exact: true });
    await editor.fill("Retain first draft");
    await expect(page.getByRole("button", { name: t.retrySave, exact: true })).toBeVisible();
    if (mobile) await page.getByRole("button", { name: t.back, exact: true }).click();
    await page.getByRole("button", { name: /Release checklist/ }).click();
    await editor.fill("Retain second draft");
    await expect(page.getByRole("button", { name: t.retrySave, exact: true })).toBeVisible();
    if (mobile) await page.getByRole("button", { name: t.back, exact: true }).click();
    await page.getByRole("button", { name: /Retain first draft/ }).click();
    await expect(editor).toHaveText("Retain first draft");
    await home(page, nav[lang].sections.home);
    const dialog = page.getByRole("dialog", { name: guard.title, exact: true });
    await dialog.getByRole("button", { name: guard.save, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(guard.failed);
    await dialog.getByRole("button", { name: guard.stay, exact: true }).click();
    await expect(editor).toHaveText("Retain first draft");
  });
  test(`an immediate navigation protects edits before the save debounce (${lang})`, async ({ page }, info) => {
    const t = notes[lang], guard = common[lang].unsaved;
    await gotoPreview(page, { lang });
    await page.route("**/rest/v1/notes**", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"message":"Synthetic save failure"}' }));
    await page.goto("/dev-preview?tab=notes");
    if (info.project.name === "mobile") await page.getByRole("button", { name: /Project ideas/ }).click();
    const editor = page.getByRole("textbox", { name: t.editorLabel, exact: true });
    await editor.fill("Immediate unsaved edit");
    if (info.project.name === "desktop") {
      await page.locator("aside").getByRole("button", { name: nav[lang].sections.notes, exact: true }).click();
      await expect(page.getByRole("dialog", { name: guard.title, exact: true })).toHaveCount(0);
      await expect(editor).toHaveText("Immediate unsaved edit");
    }
    await home(page, nav[lang].sections.home);
    const dialog = page.getByRole("dialog", { name: guard.title, exact: true });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: guard.stay, exact: true }).click();
    await expect(editor).toHaveText("Immediate unsaved edit");
  });
}
