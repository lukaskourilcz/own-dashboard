import { test, expect, type Page } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";
import { dneskaiLab } from "../src/lib/i18n/sections/dneskai-lab";
import { devsharkStudio } from "../src/lib/i18n/sections/devshark-studio";
import { designStudio } from "../src/lib/i18n/sections/design-studio";

/**
 * One Design Lab for both brands (owner request, 8 November 2026): a calendar card opens its post in the Design Lab,
 * an edited headline is saved there, and back in the calendar the dialog shows the saved version. /dev-preview keeps
 * both brands' samples in memory, so the round trip needs no server.
 */
async function openCalendar(page: Page) {
  await page.locator("aside nav").getByRole("button", { name: "Publishing calendar", exact: true }).click();
  await expect(page.getByTestId("publishing-calendar")).toBeVisible();
}

async function openPost(page: Page, brand: "DNESKAi" | "devShark") {
  const card = page.getByTestId("publishing-calendar").getByRole("listitem").filter({ hasText: brand }).first().getByRole("button");
  await card.click();
  const dialog = page.getByTestId("publishing-post-dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({}, info) => { test.skip(info.project.name === "mobile", "the round trip uses the desktop sidebar; the dialog is covered on mobile in publishing-backlog"); });

test("DNESKAi: calendar → Design Lab → edit the headline → save → the calendar shows it", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=schedule");
  const dialog = await openPost(page, "DNESKAi");
  const before = await dialog.getByTestId("post-headline").textContent();
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  await expect(page).toHaveURL(/\/projects\/dneskai\?.*labPost=/);
  const t = dneskaiLab.en, lab = page.getByTestId("dneskai-lab");
  await page.getByTestId("dneskai-slide-inspector").getByRole("textbox", { name: t.slide.fields.headline, exact: true }).fill("Calendar round trip headline");
  await lab.getByRole("button", { name: t.actions.save, exact: true }).click();
  await expect(lab.getByText(t.actions.saved).first()).toBeVisible();
  await openCalendar(page);
  const after = await openPost(page, "DNESKAi");
  await expect(after.getByTestId("post-headline")).toContainText("Calendar round trip headline");
  expect(before).not.toContain("Calendar round trip headline");
  await page.screenshot({ path: "test-results/design-lab-dneskai-calendar.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("devShark: calendar → Design Lab → edit the headline → save → the calendar shows it", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=schedule");
  const dialog = await openPost(page, "devShark");
  await expect(dialog.getByTestId("post-headline")).toContainText("typeof null");
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  await expect(page).toHaveURL(/\/projects\/devshark\?.*studioDraft=/);
  const t = devsharkStudio.en, studio = page.getByTestId("devshark-studio");
  await expect(studio.getByRole("heading", { name: t.title })).toBeVisible();
  await studio.getByText(designStudio.en.formTitle).click();
  await studio.getByRole("textbox", { name: t.fields.headline }).first().fill("typeof null, from the calendar");
  await studio.getByRole("button", { name: t.save, exact: true }).click();
  await expect(studio.getByText(t.saved)).toBeVisible();
  await page.screenshot({ path: "test-results/design-lab-devshark-editor.png", fullPage: true });
  await openCalendar(page);
  const after = await openPost(page, "devShark");
  await expect(after.getByTestId("post-headline")).toContainText("typeof null, from the calendar");
  await page.screenshot({ path: "test-results/design-lab-devshark-calendar.png", fullPage: true });
  expect(errors).toEqual([]);
});

test("DNESKAi story: the calendar's Story version opens the Design Lab in Story 9:16, and the story follows a cover edit", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=schedule");
  const dialog = await openPost(page, "DNESKAi");
  await dialog.getByRole("tab", { name: /Story/ }).click();
  await dialog.getByRole("button", { name: "Edit in Design Lab" }).click();
  await expect(page).toHaveURL(/labView=story/);
  const t = dneskaiLab.en;
  const story = page.getByTestId("dneskai-story");
  await expect(story.getByTestId("dneskai-story-image")).toBeVisible();
  const box = await story.getByTestId("dneskai-story-image").boundingBox();
  expect(box!.height / box!.width).toBeGreaterThan(1.7);
  const before = await story.getByTestId("dneskai-story-image").getAttribute("src");
  await page.getByTestId("dneskai-slide-inspector").getByRole("textbox", { name: t.slide.fields.headline, exact: true }).fill("Story follows the cover");
  await expect.poll(() => story.getByTestId("dneskai-story-image").getAttribute("src"), { timeout: 15_000 }).not.toBe(before);
  await page.screenshot({ path: "test-results/design-lab-dneskai-story.png", fullPage: true });
  expect(errors).toEqual([]);
});

