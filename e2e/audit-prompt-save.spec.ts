import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { prompts } from "../src/lib/i18n/sections/prompts";
import { CURATED_PROMPTS } from "../src/lib/curated-prompts";

for (const lang of ["en", "cs"] as const) {
  test(`failed prompt creation keeps its fields and retries the same identity (${lang})`, async ({ page }) => {
    const t = prompts[lang];
    await gotoPreview(page, { lang }); await signInFixtureUser(page);
    await page.goto("/dev-preview?tab=prompts");
    const writes: Array<{ p_id: string; p_creating: boolean; p_header: { name: string } }> = [];
    await page.route("**/rest/v1/rpc/save_prompt_document", async route => {
      writes.push(route.request().postDataJSON());
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"code":"XX000","message":"Synthetic storage failure"}' });
    });
    await page.getByRole("button", { name: t.newPrompt, exact: true }).click();
    const dialog = page.getByRole("dialog", { name: t.newTitle, exact: true });
    await dialog.getByLabel(t.name, { exact: true }).fill("Retained prompt draft");
    await dialog.getByLabel(t.promptText, { exact: true }).fill("Review this source and explain the concrete findings.");
    await dialog.getByRole("button", { name: t.create, exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText(t.couldNotSave);
    await expect(dialog.getByLabel(t.name, { exact: true })).toHaveValue("Retained prompt draft");
    await dialog.getByRole("button", { name: t.create, exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[0].p_id).toBe(writes[1].p_id); expect(writes[0].p_creating).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(axe.violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test("prompt edits send the complete captured source and retain resource instructions on failure", async ({ page }) => {
  const t = prompts.en;
  await gotoPreview(page); await page.goto("/dev-preview?tab=prompts");
  const writes: Array<{ p_id: string; p_creating: boolean; p_expected_link_ids: string[]; p_links: { ai_link_id: string; note: string }[] }> = [];
  await page.route("**/rest/v1/rpc/save_prompt_document", async route => {
    writes.push(route.request().postDataJSON());
    await route.fulfill({ status: 409, contentType: "application/json", body: '{"code":"40001","message":"Synthetic stale source"}' });
  });
  await page.locator('[data-prompt-card="pr1"]').getByRole("button", { name: `${t.edit}: Code review`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: t.editTitle, exact: true });
  const instruction = dialog.getByRole("textbox", { name: /^Note 1:/ });
  await instruction.fill("Retain this resource instruction");
  await dialog.getByRole("button", { name: t.save, exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(t.saveConflict);
  await expect(instruction).toHaveValue("Retain this resource instruction");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ p_id: "pr1", p_creating: false, p_expected_link_ids: ["prl2"], p_links: [{ ai_link_id: "al2", note: "Retain this resource instruction" }] });
});

test("curated imports use the transaction endpoint and retain one copy after a repeat", async ({ page }) => {
  const t = prompts.en;
  await gotoPreview(page); await page.goto("/dev-preview?tab=prompts");
  let imports = 0;
  const added = CURATED_PROMPTS.filter(prompt => !["SEO check", "Launch announcement"].includes(prompt.name));
  await page.route("**/rest/v1/rpc/add_curated_prompts", async route => {
    imports++;
    expect(route.request().postDataJSON().p_templates.map((prompt: { name: string }) => prompt.name)).toEqual(CURATED_PROMPTS.map(prompt => prompt.name));
    const rows = imports === 1 ? added.map((prompt, index) => ({ ...prompt, id: `curated-${index}`, user_id: "u1", project_id: null,
      is_public: true, created_at: "2026-10-23T12:00:00Z", updated_at: "2026-10-23T12:00:00Z" })) : [];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(rows) });
  });
  await page.getByRole("button", { name: t.addCurated, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Design direction", exact: true })).toBeVisible();
  await expect(page.locator("[data-prompt-card]")).toHaveCount(5 + added.length);
  await page.getByRole("button", { name: t.addCurated, exact: true }).click();
  await expect.poll(() => imports).toBe(2);
  await expect(page.locator("[data-prompt-card]")).toHaveCount(5 + added.length);
  await expect(page.getByText(t.curatedNoneNew, { exact: true })).toBeVisible();
});
