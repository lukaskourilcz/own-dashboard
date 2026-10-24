import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser, stubGithubRepositories, watchConsole } from "./helpers";
import { github } from "../src/lib/i18n/sections/github";
const owner = "11111111-1111-4111-8111-111111111111", id = "33333333-3333-4333-8333-333333333333";
const repo = { id: 123, name: "own-dashboard", full_name: "lukaskourilcz/own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ["en", "cs"] as const) test(`${lang}: repository links retain failed drafts, review conflicts and confirm removals`, async ({ page }) => {
  const t = github[lang], errors = watchConsole(page);
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" }); await signInFixtureUser(page);
  await page.route("**/auth/v1/user", route => route.fulfill({ json: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", user_metadata: {} } }));
  await stubGithubRepositories(page, [repo]);
  await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
  let rows: Record<string, unknown>[] = [], creations = 0, updates = 0, deletions = 0, release!: () => void;
  await page.route("**/rest/v1/rpc/**", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "repo_links" ? rows : [] }));
  await page.route("**/rest/v1/repo_links**", async route => {
    const method = route.request().method();
    if (method === "POST") {
      creations++; if (creations === 1) { await route.fulfill({ json: null }); return; }
      await new Promise<void>(resolve => { release = resolve; });
      const row = { ...route.request().postDataJSON(), id, created_at: "2026-10-24T04:00:00Z" }; rows = [row]; await route.fulfill({ json: row }); return;
    }
    if (method === "PATCH") {
      updates++; const query = new URL(route.request().url()).searchParams; expect(query.get("id")).toBe(`eq.${id}`); expect(query.get("user_id")).toBe(`eq.${owner}`);
      if (updates === 1) { rows = rows.map(row => ({ ...row, url: "https://changed.test/", updated_at: "2099-01-01T00:00:00Z" })); await route.fulfill({ status: 409, json: { message: "Fixture version changed" } }); return; }
      expect(query.get("updated_at")).toBe("eq.2099-01-01T00:00:00Z"); rows = rows.map(row => ({ ...row, ...route.request().postDataJSON() })); await route.fulfill({ json: rows[0] }); return;
    }
    if (method === "DELETE") { deletions++; if (deletions === 1) { await route.fulfill({ json: null }); return; } const row = rows[0]; rows = []; await route.fulfill({ json: row }); return; }
    await route.fulfill({ json: rows });
  });
  await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
  await page.getByRole("button", { name: t.linkAdd, exact: true }).click(); const input = page.getByRole("textbox", { name: t.linkLabel, exact: true });
  await input.fill("javascript://unsafe.test"); await page.getByRole("button", { name: t.save, exact: true }).click(); await expect(page.getByText(t.linkInvalid, { exact: true })).toBeVisible(); expect(creations).toBe(0);
  await input.fill("example.test/retained"); await page.getByRole("button", { name: t.save, exact: true }).click(); await expect(page.getByText(t.linkErr, { exact: true })).toBeVisible(); await expect(input).toHaveValue("example.test/retained");
  await page.getByRole("button", { name: t.save, exact: true }).click(); await expect(input).toBeDisabled(); await page.keyboard.press("Escape"); await expect(input).toBeVisible(); await expect.poll(() => typeof release).toBe("function"); release();
  await expect(input).not.toBeVisible(); await expect(page.locator('a[href="https://example.test/retained"]')).toBeVisible();
  await page.getByRole("button", { name: t.linkEdit, exact: true }).click(); await input.fill("https://my-draft.test/"); await page.getByRole("button", { name: t.save, exact: true }).click();
  await expect(page.getByText(t.linkChanged, { exact: true })).toBeVisible(); await expect(input).toHaveValue("https://my-draft.test/"); await expect(page.getByRole("button", { name: t.save, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: t.linkReviewCurrent, exact: true }).click(); await expect(input).toHaveValue("https://my-draft.test/"); await page.getByRole("button", { name: t.save, exact: true }).click();
  await expect(input).not.toBeVisible(); await expect(page.locator('a[href="https://my-draft.test/"]')).toBeVisible();
  await page.getByRole("button", { name: t.linkEdit, exact: true }).click(); await page.getByRole("button", { name: t.linkRemove, exact: true }).click(); await expect(page.getByText(t.linkErr, { exact: true })).toBeVisible(); await expect(page.locator('a[href="https://my-draft.test/"]')).toBeVisible();
  const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").include('[data-radix-popper-content-wrapper]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(axe.violations).toEqual([]);
  await page.getByRole("button", { name: t.linkRemove, exact: true }).click(); await expect(input).not.toBeVisible(); await expect(page.locator('a[href="https://my-draft.test/"]')).toHaveCount(0); await expect(page.getByRole("button", { name: t.linkAdd, exact: true })).toBeVisible();
  expect(creations).toBe(2); expect(updates).toBe(2); expect(deletions).toBe(2);
  expect(errors.filter(error => !(error.includes("status of 409") && error.includes("/rest/v1/repo_links")))).toEqual([]);
});
