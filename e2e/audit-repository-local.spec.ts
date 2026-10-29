import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser, watchConsole } from "./helpers";
import { github } from "../src/lib/i18n/sections/github";
const owner = "11111111-1111-4111-8111-111111111111";
const note = { id: "33333333-3333-4333-8333-333333333333", user_id: owner, repo_id: "1001", repo_full_name: "lukaskourilcz/old-dashboard-name", body: "Saved without provider access", sort_order: 1, created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" };
const repo = { id: 1001, name: "own-dashboard", full_name: "lukaskourilcz/own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: a cold disconnected workspace retains and edits its owned notes`, async ({ page }) => {
    const t = github[lang], errors = watchConsole(page); await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" }); await signInFixtureUser(page);
    await page.route("**/auth/v1/user", route => route.fulfill({ json: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", user_metadata: {} } }));
    let row = { ...note }, saves = 0, publications = 0, available = false;
    await page.route("**/api/github/repos/lookup?**", route => route.fulfill(available ? { json: { id: repo.id, full_name: repo.full_name, repo } } : { status: 401, json: { reason: "no-token" } }));
    await page.route("**/api/github/commit", route => { publications++; return route.fulfill({ status: 503 }); });
    await page.route("**/rest/v1/rpc/**", route => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1), input = route.request().postDataJSON();
      if (name === "read_owned_collection") return route.fulfill({ json: input.p_entity === "repo_notes" ? [row, { ...note, id: "44444444-4444-4444-8444-444444444444", repo_id: "9999", repo_full_name: repo.full_name, body: "Another repository's note" }] : [] });
      if (name === "save_repository_note") { saves++; expect(input.p_expected.repo_id).toBe("1001"); row = { ...row, body: input.p_body, updated_at: "2026-10-24T04:01:00Z" }; return route.fulfill({ json: row }); }
      return route.fulfill({ json: [] });
    });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await expect(page.getByText(note.body, { exact: true })).toBeVisible(); await expect(page.getByText("Another repository's note", { exact: true })).toHaveCount(0);
    await expect(page.getByText(t.localRecordsAvailable, { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: t.saveNotes, exact: true })).toBeDisabled();
    await page.getByRole("button", { name: t.editNote, exact: true }).click(); const field = page.getByRole("textbox", { name: t.editNote, exact: true }); await field.fill("Edited while disconnected"); await page.getByRole("button", { name: t.doneEditing, exact: true }).click();
    await expect(field).toHaveCount(0); await expect(page.getByText("Edited while disconnected", { exact: true })).toBeVisible(); expect(saves).toBe(1); expect(publications).toBe(0);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true); }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    available = true; await page.reload(); await expect(page.getByText("Edited while disconnected", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: t.saveNotes, exact: true })).toBeEnabled();
    await expect(page.getByText(t.localRecordsAvailable, { exact: true })).toHaveCount(0); expect(publications).toBe(0);
    expect(errors.filter(error => !(error.includes("status of 401") && error.includes("/api/github/repos/lookup?")))).toEqual([]);
  });
  test(`${lang}: a reused repository name cannot select a different id for publication`, async ({ page }) => {
    const t = github[lang]; await gotoPreview(page, { lang });
    await page.route("**/api/github/repos/lookup?**", route => route.fulfill({ json: { id: 9999, full_name: repo.full_name, repo: { ...repo, id: 9999 } } }));
    await page.route("**/rest/v1/rpc/**", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "repo_notes" ? [note] : [] }));
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await expect(page.getByText(t.repositoryUnavailable, { exact: true })).toBeVisible(); await expect(page.getByText(note.body, { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: t.saveNotes, exact: true })).toBeDisabled(); await expect(page.getByRole("button", { name: t.writeFile, exact: true })).toHaveCount(0);
  });
}
