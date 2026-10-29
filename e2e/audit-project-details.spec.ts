import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, stubGithubRepositories, watchConsole } from "./helpers";
import { projects } from "../src/lib/i18n/sections/projects";
import { common } from "../src/lib/i18n/sections/common";
import type { Project } from "../src/lib/types";
import type { GithubRepo } from "../src/lib/github";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", owner = "11111111-1111-4111-8111-111111111111";
const renamedRepo: GithubRepo = { id: 101, name: "next", full_name: "owner/next", owner: "owner", description: null, private: false, fork: false, archived: false,
  html_url: "https://github.com/owner/next", default_branch: "main", language: "TypeScript", stargazers_count: 0, pushed_at: null, updated_at: null };
async function fixture(page: Page, lang: "en" | "cs", repository = false) {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let sequence = 0, calls = 0, writes = 0, direct = 0, fail = false, hold = false, release: (() => void) | undefined;
  const stamp = () => new Date(Date.UTC(2026, 9, 24, 14, 0, sequence++)).toISOString();
  let row: Project = { id, user_id: owner, name: "Details fixture", slug: "details-fixture", notes: "Retained private project note", repo_full_name: repository ? "owner/current" : null,
    repo_id: repository ? 101 : null, previous_repo_full_names: repository ? ["owner/earlier"] : [], previous_slugs: [], sort_order: 0, is_active: true, engagement: "own", organization_id: null,
    parent_id: null, url: null, dev_url: null, color: null, created_at: stamp(), updated_at: stamp() };
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "projects" ? [row] : [] }));
  await page.route("**/rest/v1/projects?**", route => { if (route.request().method() !== "GET") direct++; return route.fulfill({ json: [] }); });
  await page.route("**/rest/v1/rpc/save_project_details", async route => {
    calls++; const input = route.request().postDataJSON(), values = input.p_values;
    expect(Object.keys(input).sort()).toEqual(["p_expected_updated_at", "p_id", "p_values"]); expect(input.p_id).toBe(id);
    expect(Object.keys(values).sort()).toEqual(["dev_url", "engagement", "name", "organization_id", "repo_full_name", "repo_id", "slug", "url"]);
    expect(JSON.stringify(input)).not.toContain("Retained private project note");
    if (hold) await new Promise<void>(resolve => { release = resolve; }); release = undefined;
    if (fail) return route.fulfill({ status: 503, json: { message: "Private fixture provider details" } });
    const before = row.updated_at, same = Object.entries(values).every(([key, value]) => row[key as keyof Project] === value);
    if (!same && input.p_expected_updated_at !== before) return route.fulfill({ json: { kind: "conflict", id, user_id: owner, source_updated_at: before, updated_at: before } });
    if (!same) {
      const previous_slugs = [...row.previous_slugs!], previous_repo_full_names = [...row.previous_repo_full_names!];
      if (values.slug !== row.slug && !previous_slugs.includes(row.slug)) previous_slugs.push(row.slug);
      if (row.repo_id === values.repo_id && row.repo_id !== null && row.repo_full_name && values.repo_full_name.toLowerCase() !== row.repo_full_name.toLowerCase()) previous_repo_full_names.push(row.repo_full_name);
      row = { ...row, ...values, previous_slugs, previous_repo_full_names, updated_at: stamp() }; writes++;
    }
    return route.fulfill({ json: { kind: "saved", id, user_id: owner, values, previous_slugs: row.previous_slugs, previous_repo_full_names: row.previous_repo_full_names, source_updated_at: before, updated_at: row.updated_at } });
  });
  await page.goto("/dev-preview?tab=projects&projectRecords=live");
  await page.getByRole("table").getByRole("button", { name: common[lang].edit, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: projects[lang].editProject, exact: true }); await expect(dialog).toBeVisible();
  return { dialog, fail: (next: boolean) => { fail = next; }, hold: (next: boolean) => { hold = next; },
    release: async () => { await expect.poll(() => typeof release).toBe("function"); release!(); },
    external: (patch: Partial<Project>) => { row = { ...row, ...patch, updated_at: stamp() }; }, state: () => ({ calls, writes, direct, row }) };
}

for (const lang of ["en", "cs"] as const) {
  test(`${lang}: project edits survive failed guarded saves and confirm only metadata`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = projects[lang], c = common[lang];
    f.fail(true); f.hold(true);
    await f.dialog.getByRole("textbox", { name: t.name, exact: true }).fill("Renamed fixture");
    await f.dialog.getByRole("textbox", { name: t.slug, exact: true }).fill("renamed-fixture");
    await f.dialog.getByRole("textbox", { name: t.url, exact: true }).fill("https://example.com");
    await f.dialog.getByRole("button", { name: lang === "cs" ? "Zavřít" : "Close", exact: true }).click();
    const guard = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: c.unsaved.stay, exact: true }) }); await expect(guard).toBeVisible();
    await guard.getByRole("button", { name: c.unsaved.save, exact: true }).click();
    await expect(guard.getByRole("button", { name: c.unsaved.discard, exact: true })).toBeDisabled(); await f.release();
    await expect(guard.getByRole("alert")).toHaveText(c.unsaved.failed); await guard.getByRole("button", { name: c.unsaved.stay, exact: true }).click();
    await expect(f.dialog.getByRole("textbox", { name: t.name, exact: true })).toHaveValue("Renamed fixture");
    await expect(f.dialog.getByRole("alert")).toHaveText(t.preferenceSaveFailed);
    f.fail(false); f.hold(false); await f.dialog.getByRole("button", { name: c.save, exact: true }).click(); await expect(f.dialog).toHaveCount(0);
    await expect(page.getByRole("table").getByRole("link", { name: "Renamed fixture", exact: true })).toHaveAttribute("href", "/projects/renamed-fixture");
    expect(f.state().row).toMatchObject({ notes: "Retained private project note", url: "https://example.com/", previous_slugs: ["details-fixture"] });
    expect(f.state().calls).toBe(2); expect(f.state().writes).toBe(1); expect(f.state().direct).toBe(0);
    expect(errors.filter(error => !(error.includes("503") && error.includes("/rpc/save_project_details")))).toEqual([]);
  });
  test(`${lang}: a metadata conflict retains the draft until an explicit saved-detail reload`, async ({ page }, info) => {
    const errors = watchConsole(page), f = await fixture(page, lang), t = projects[lang], c = common[lang];
    await f.dialog.getByRole("textbox", { name: t.name, exact: true }).fill("My retained edit"); f.external({ name: "Changed elsewhere", notes: "Later private note" });
    await f.dialog.getByRole("button", { name: c.save, exact: true }).click(); await expect(f.dialog.getByRole("alert")).toHaveText(t.detailsConflict);
    await expect(f.dialog.getByRole("textbox", { name: t.name, exact: true })).toHaveValue("My retained edit"); await expect(f.dialog.getByRole("button", { name: c.save, exact: true })).toBeDisabled();
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    if (lang === "cs") {
      const width = info.project.name === "mobile" ? 360 : 1440;
      await page.setViewportSize({ width, height: 1000 });
      await f.dialog.screenshot({ path: `/tmp/app-audit-project-details-conflict-cs-${width}.png` });
    }
    await f.dialog.getByRole("button", { name: t.reloadDetails, exact: true }).click();
    const guard = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: c.unsaved.stay, exact: true }) }); await expect(guard).toBeVisible(); await expect(guard.getByRole("button", { name: c.unsaved.save, exact: true })).toBeDisabled();
    await guard.getByRole("button", { name: c.unsaved.discard, exact: true }).click();
    await expect(f.dialog.getByRole("textbox", { name: t.name, exact: true })).toHaveValue("Changed elsewhere");
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 900 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect.poll(async () => (await f.dialog.getByRole("textbox", { name: t.name, exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    await f.dialog.getByRole("textbox", { name: t.name, exact: true }).fill("After reload"); await f.dialog.getByRole("button", { name: c.save, exact: true }).click(); await expect(f.dialog).toHaveCount(0);
    expect(f.state().row).toMatchObject({ name: "After reload", notes: "Later private note" }); expect(f.state().calls).toBe(2); expect(f.state().writes).toBe(1); expect(f.state().direct).toBe(0); expect(errors).toEqual([]);
  });
  test(`${lang}: a repository rename requires a verified identity and keeps its earlier name`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang, true), t = projects[lang], c = common[lang];
    await page.route("**/api/github/repos/lookup?**", route => route.fulfill({ status: 503, json: { error: "Fixture unavailable" } }));
    await f.dialog.getByRole("textbox", { name: t.repo, exact: true }).fill("owner/next"); await f.dialog.getByRole("button", { name: c.save, exact: true }).click();
    await expect(f.dialog.getByRole("alert")).toHaveText(t.detailsRepositoryUnavailable); expect(f.state().calls).toBe(0);
    await expect(f.dialog.getByRole("textbox", { name: t.repo, exact: true })).toHaveValue("owner/next");
    await stubGithubRepositories(page, [renamedRepo]); await f.dialog.getByRole("button", { name: c.save, exact: true }).click(); await expect(f.dialog).toHaveCount(0);
    expect(f.state().row).toMatchObject({ repo_id: 101, repo_full_name: "owner/next", previous_repo_full_names: ["owner/earlier", "owner/current"], notes: "Retained private project note" });
    expect(f.state().writes).toBe(1); expect(f.state().direct).toBe(0); expect(errors.filter(error => !(error.includes("503") && error.includes("/api/github/repos/lookup")))).toEqual([]);
  });
}
