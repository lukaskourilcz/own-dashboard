import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { common } from "../src/lib/i18n/sections/common";
import { github } from "../src/lib/i18n/sections/github";
import { professional } from "../src/lib/i18n/sections/professional";
const owner = "11111111-1111-4111-8111-111111111111";
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: unavailable task sources recover and atomic imports retain failed work`, async ({ page }) => {
    const t = github[lang]; await gotoPreview(page, { lang }); await signInFixtureUser(page);
    await page.route("**/auth/v1/user", route => route.fulfill({ json: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", user_metadata: {} } }));
    await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
    await page.route("**/api/github/repos", route => route.fulfill({ json: { repos: [{ id: 123, name: "own-dashboard", full_name: "lukaskourilcz/own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null }] } }));
    let available = false, reads = 0, imports = 0, batches = 0;
    const sourceContent = "```md\n- [ ] Example task\n```\n- [x] Finished task\n- [ ] Actual import task\n  [owner:ai]\n- Explanatory note";
    await page.route("**/api/github/needed", route => {
      batches++; expect(route.request().postDataJSON().repos).toEqual([{ id: 123, owner: "lukaskourilcz", name: "own-dashboard" }]);
      return !available ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { kind: "ok", files: [{ repoId: "123", result: { kind: "ok", path: "NEEDED.md", sha: "a".repeat(40), content: sourceContent, htmlUrl: "https://github.com/lukaskourilcz/own-dashboard/blob/main/NEEDED.md" } }] } });
    });
    await page.route("**/api/github/file?**", route => {
      reads++; return !available ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: { content: sourceContent, sha: "a".repeat(40), html_url: "https://github.com/lukaskourilcz/own-dashboard/blob/main/NEEDED.md" } });
    });
    await page.route("**/rest/v1/rpc/sync_repository_tasks", route => {
      const input = route.request().postDataJSON(); expect(input.p_rows).toHaveLength(1); expect(input.p_rows[0].needed_assignee).toBe("ai"); expect(input.p_remove).toEqual([]);
      return ++imports === 1 ? route.fulfill({ json: {} }) : route.fulfill({ json: { inserted: [{ ...input.p_rows[0], id: "33333333-3333-4333-8333-333333333333" }], deleted_ids: [], retained_ids: [] } });
    });
    await page.route("**/api/github/commit", route => { expect(route.request().postDataJSON()).toMatchObject({ intent: "edit", expectedSha: "a".repeat(40) }); return route.fulfill({ status: 409, json: {} }); });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await page.getByRole("button", { name: t.needed.button, exact: true }).click();
    await expect(page.getByText(t.needed.unavailable("lukaskourilcz/own-dashboard"), { exact: true })).toBeVisible();
    await expect(page.getByText(t.needed.allClear, { exact: true })).toHaveCount(0); available = true;
    await page.getByRole("button", { name: common[lang].retry, exact: true }).click();
    const action = page.getByRole("button", { name: `${t.needed.checkOff}: Actual import task`, exact: true }); await expect(action).toBeVisible();
    for (const text of ["Example task", "Finished task", "Explanatory note"]) await expect(page.getByText(text, { exact: true })).toHaveCount(0);
    const create = page.getByRole("button", { name: t.needed.createTodos, exact: true }); await create.click(); await expect(page.getByText(t.needed.todosErr, { exact: true })).toBeVisible(); await expect(create).toBeEnabled();
    await create.click(); await expect(page.getByText(t.needed.todosCreated(1, 1), { exact: true })).toBeVisible(); expect(imports).toBe(2);
    const priorReads = reads; await action.click(); await expect(page.getByText(t.fileChanged, { exact: true })).toBeVisible(); await expect.poll(() => reads).toBe(priorReads + 1); expect(batches).toBe(2);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) { await page.setViewportSize({ width, height: 1000 }); expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1); }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
  });
  test(`${lang}: repository note failure, keyboard recovery and publication retain changed records`, async ({ page }) => {
    const t = github[lang]; await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" }); await signInFixtureUser(page);
    await page.route("**/auth/v1/user", route => route.fulfill({ json: { id: owner, aud: "authenticated", role: "authenticated", email: "fixture@example.test", user_metadata: {} } }));
    const repo = { id: 123, name: "own-dashboard", full_name: "lukaskourilcz/own-dashboard", owner: "lukaskourilcz", description: null, private: true, fork: false, archived: false, html_url: "https://github.com/lukaskourilcz/own-dashboard", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
    await page.route("**/api/vercel/analytics**", route => route.fulfill({ json: { kind: "unconfigured" } }));
    await page.route("**/api/github/repos", route => route.fulfill({ json: { repos: [repo] } }));
    let rows: Record<string, unknown>[] = [], saves = 0, release!: () => void;
    await page.route("**/rest/v1/repo_notes**", async route => {
      if (route.request().method() === "POST") {
        const body = route.request().postDataJSON(); const row = { ...body, created_at: "2026-10-24T04:00:00Z", updated_at: "2026-10-24T04:00:00Z" }; rows.push(row); return route.fulfill({ json: row });
      }
      return route.fulfill({ json: rows });
    });
    await page.route("**/rest/v1/rpc/**", async route => {
      const name = new URL(route.request().url()).pathname.split("/").at(-1), input = route.request().postDataJSON();
      if (name === "read_owned_collection") return route.fulfill({ json: input.p_entity === "repo_notes" ? rows : [] });
      if (name === "save_repository_note") {
        if (++saves === 1) return route.fulfill({ status: 409, json: { message: "Synthetic write unavailable" } });
        rows = rows.map(row => row.id === input.p_id ? { ...row, body: input.p_body, updated_at: "2026-10-24T04:01:00Z" } : row);
        return route.fulfill({ json: rows.find(row => row.id === input.p_id) });
      }
      if (name === "consume_repository_records") return route.fulfill({ json: { deleted_ids: [], retained_ids: input.p_rows.map((row: { id: string }) => row.id) } });
      return route.fulfill({ json: [] });
    });
    await page.route("**/api/github/commit", async route => {
      const input = route.request().postDataJSON(); expect(input.intent).toBe("replace"); expect(input.content).toContain("Keep this draft");
      await new Promise<void>(resolve => { release = resolve; });
      return route.fulfill({ json: { path: "dashboard-notes.md", updated: true, unchanged: false, commit: { sha: "b".repeat(40), html_url: "https://github.com/lukaskourilcz/own-dashboard/commit/fixture" }, content: { sha: "a".repeat(40), html_url: "https://github.com/lukaskourilcz/own-dashboard/blob/main/dashboard-notes.md" } } });
    });
    await page.goto("/dev-preview?project=own-dashboard&repositories=live&projectTab=repository");
    await expect(page.getByRole("tab", { name: professional[lang].projectRepository, exact: true })).toHaveAttribute("aria-selected", "true");
    await page.getByRole("button", { name: t.addNote, exact: true }).click();
    const text = page.getByRole("textbox", { name: t.editNote, exact: true }); await expect(text).toBeFocused(); await text.fill("Keep this draft");
    await page.getByRole("button", { name: t.doneEditing, exact: true }).click();
    await expect(text).toHaveValue("Keep this draft"); await expect(text).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: t.doneEditing, exact: true }).focus(); await page.keyboard.press("Enter");
    await expect(text).toHaveCount(0); await expect(page.getByText("Keep this draft", { exact: true })).toBeVisible();
    expect(saves).toBe(2);
    await page.getByRole("button", { name: t.saveNotes, exact: true }).click(); await expect.poll(() => !!release).toBe(true);
    rows = rows.map(row => ({ ...row, body: "Edited in another window" })); release();
    await expect(page.getByRole("button", { name: t.saveNotes, exact: true })).toBeEnabled();
    await expect(page.getByText(t.notesSavedFile("dashboard-notes.md"), { exact: true })).toBeVisible(); expect(rows).toHaveLength(1);
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 });
      const refresh = page.getByRole("button", { name: t.refresh, exact: true });
      const disconnect = page.getByRole("button", { name: t.disconnect, exact: true });
      const editNote = page.getByRole("button", { name: t.editNote, exact: true });
      if (width < 768) await expect.poll(async () => (await editNote.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      for (const control of [refresh, disconnect, editNote]) {
        await expect.poll(async () => (await control.boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
        await expect.poll(async () => { const box = await control.boundingBox(); return box ? box.x + box.width : Infinity; }).toBeLessThanOrEqual(width);
      }
      if (lang === "cs" && (width === 360 || width === 1440)) await page.locator('[role="tabpanel"]').screenshot({ path: `/tmp/app-audit-repository-notes-cs-${width}.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    }
    const scan = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include("main").withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze(); expect(scan.violations).toEqual([]);
  });
}
