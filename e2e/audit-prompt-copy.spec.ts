import { expect, test } from "@playwright/test";
import { gotoPreview } from "./helpers";
import { prompts } from "../src/lib/i18n/sections/prompts";

test("a late clipboard result cannot close a newly opened prompt preview", async ({ page }) => {
  const t = prompts.en;
  await gotoPreview(page); await page.goto("/dev-preview?tab=prompts");
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => new Promise<void>(resolve => {
      (window as unknown as { finishCopy: () => void }).finishCopy = resolve;
    }) });
  });
  await page.getByRole("button", { name: `${t.copyWithContext}: Code review`, exact: true }).click();
  const first = page.getByRole("dialog", { name: t.copyTitle("Code review"), exact: true });
  await first.getByRole("button", { name: t.copyAction, exact: true }).click();
  await expect(first.getByRole("button", { name: t.copyAction, exact: true })).toBeDisabled();
  await first.getByRole("button", { name: t.cancel, exact: true }).click();
  await page.getByRole("button", { name: `${t.copyWithContext}: SEO check`, exact: true }).click();
  const second = page.getByRole("dialog", { name: t.copyTitle("SEO check"), exact: true });
  await expect(second).toBeVisible();
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  await expect(second).toBeVisible();
  await expect(second.getByLabel(t.copyPreview, { exact: true })).toHaveValue(/Run an SEO check/);
});

test("reopening a copy preview clears the previous clipboard failure", async ({ page }) => {
  const t = prompts.en;
  await gotoPreview(page); await page.goto("/dev-preview?tab=prompts");
  await page.evaluate(() => Object.defineProperty(navigator.clipboard, "writeText", { configurable: true,
    value: async () => { throw new Error("Synthetic clipboard denial"); } }));
  const opener = page.getByRole("button", { name: `${t.copyWithContext}: Code review`, exact: true });
  await opener.click();
  const dialog = page.getByRole("dialog", { name: t.copyTitle("Code review"), exact: true });
  await dialog.getByRole("button", { name: t.copyAction, exact: true }).click();
  await expect(dialog.getByRole("status")).toHaveText(t.couldNotCopyManual);
  await dialog.getByRole("button", { name: t.cancel, exact: true }).click();
  await opener.click();
  await expect(dialog.getByRole("status")).toBeEmpty();
});
