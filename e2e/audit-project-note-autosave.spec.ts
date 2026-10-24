import { createHash } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { projects } from "../src/lib/i18n/sections/projects";
import { common } from "../src/lib/i18n/sections/common";
import { notes } from "../src/lib/i18n/sections/notes";
const owner = "11111111-1111-4111-8111-111111111111", id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", hash = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(page: Page, lang: "en" | "cs", name = "Notes fixture") {
  await gotoPreview(page, { lang, theme: lang === "cs" ? "dark" : "light" });
  let sequence = 0, calls = 0, saved = 0, fail = false, active = 0, maxActive = 0, directWrites = 0;
  const stamp = () => new Date(Date.UTC(2026, 9, 24, 12, 0, sequence++)).toISOString();
  let row = { id, user_id: owner, name, slug: "notes-fixture", notes: "Original project note", repo_full_name: null, sort_order: 0, is_active: true, engagement: "own", parent_id: null, url: null, dev_url: null, color: null, created_at: stamp(), updated_at: stamp() };
  await page.route("**/rest/v1/rpc/read_owned_collection", route => route.fulfill({ json: route.request().postDataJSON().p_entity === "projects" ? [row] : [] }));
  await page.route("**/rest/v1/projects?**", route => { if (route.request().method() !== "GET") directWrites++; return route.fulfill({ json: [] }); });
  await page.route("**/rest/v1/rpc/save_project_notes", async route => {
    calls++; maxActive = Math.max(maxActive, ++active);
    try {
      const input = route.request().postDataJSON(); expect(Object.keys(input).sort()).toEqual(["p_expected_hash", "p_id", "p_notes"]); expect(input.p_id).toBe(id);
      if (fail) return await route.fulfill({ status: 503, json: { message: "Fixture unavailable" } });
      const sourceHash = hash(row.notes), desiredHash = hash(input.p_notes), before = row.updated_at;
      const kind = sourceHash === desiredHash || input.p_expected_hash === sourceHash ? "saved" : "conflict";
      if (kind === "saved" && sourceHash !== desiredHash) { saved++; row = { ...row, notes: input.p_notes, updated_at: stamp() }; }
      return await route.fulfill({ json: { kind, id, user_id: owner, notes_hash: hash(row.notes), source_notes_hash: sourceHash, source_updated_at: before, updated_at: row.updated_at } });
    } finally { active--; }
  });
  await page.goto("/dev-preview?tab=projects&projectRecords=live");
  await page.getByRole("table", { name: projects[lang].title, exact: true }).getByRole("button", { name: projects[lang].manage, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: projects[lang].manage, exact: true });
  const editor = dialog.getByRole("textbox", { name: notes[lang].editorLabel, exact: true }); await expect(editor).toBeVisible();
  return { dialog, editor, fail: (value: boolean) => { fail = value; }, external: (text: string) => { row = { ...row, notes: text, updated_at: stamp() }; },
    state: () => ({ calls, saved, maxActive, directWrites, row }) };
}
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: project-note drafts survive failed save and an immediate dialog exit`, async ({ page }) => {
    const errors = watchConsole(page), t = projects[lang], c = common[lang], f = await fixture(page, lang);
    f.fail(true); await f.editor.fill("Immediate project draft"); await f.dialog.getByRole("button", { name: lang === "cs" ? "Zavřít" : "Close", exact: true }).click();
    const guard = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: c.unsaved.stay, exact: true }) }); await expect(guard).toBeVisible();
    await expect(guard.getByRole("button", { name: c.unsaved.save, exact: true })).toBeEnabled();
    await guard.getByRole("button", { name: c.unsaved.save, exact: true }).click(); await expect(guard.getByRole("alert")).toHaveText(c.unsaved.failed);
    await guard.getByRole("button", { name: c.unsaved.stay, exact: true }).click(); await expect(f.editor).toHaveText("Immediate project draft");
    await expect(f.dialog.getByText(t.notesSaveFailed, { exact: true })).toBeVisible();
    for (const width of [360, 430, 768, 1024, 1440, 1728]) {
      await page.setViewportSize({ width, height: 1000 }); await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const costFields = [f.dialog.getByRole("textbox", { name: t.costLabel, exact: true }), f.dialog.getByRole("spinbutton", { name: t.amount, exact: true }), f.dialog.getByRole("combobox", { name: t.currency, exact: true }), f.dialog.getByRole("textbox", { name: t.costNotePlaceholder, exact: true })];
      for (const field of costFields) {
        const box = await field.boundingBox(); expect(box).not.toBeNull(); expect(box!.width).toBeGreaterThanOrEqual(70);
        await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
      }
      expect((await costFields[3].boundingBox())!.width).toBeGreaterThanOrEqual(100);
      await expect.poll(() => costFields[2].locator(":scope > span").first().evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      const name = await f.dialog.getByText("Notes fixture", { exact: true }).boundingBox(), total = await f.dialog.getByText(t.perMo, { exact: true }).first().locator("..").boundingBox();
      expect(name!.width).toBeGreaterThanOrEqual(80);
      expect(name!.y + name!.height <= total!.y || name!.x + name!.width <= total!.x).toBe(true);
    }
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).include('[role="dialog"]').withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()).violations).toEqual([]);
    f.fail(false); await f.dialog.getByRole("button", { name: c.retry, exact: true }).click(); await expect.poll(() => f.state().saved).toBe(1);
    await expect(f.dialog.getByText(t.notesSaved, { exact: true })).toBeVisible(); await f.dialog.getByRole("button", { name: lang === "cs" ? "Zavřít" : "Close", exact: true }).click(); await expect(f.dialog).toHaveCount(0);
    expect(f.state().maxActive).toBe(1); expect(f.state().directWrites).toBe(0);
    expect(await page.evaluate(() => Object.values(localStorage).some(value => value.includes("Immediate project draft")))).toBe(false);
    expect(errors.filter(error => !(error.includes("503") && error.includes("/rpc/save_project_notes")))).toEqual([]);
  });
  test(`${lang}: conflicts retain draft text until explicit replacement or reload`, async ({ page }, info) => {
    const errors = watchConsole(page), t = projects[lang], f = await fixture(page, lang);
    f.external("Changed in another editor"); await f.editor.fill("My retained draft"); await expect(f.dialog.getByText(t.notesConflict, { exact: true })).toBeVisible(); await expect(f.editor).toHaveText("My retained draft");
    if (lang === "cs") {
      const width = info.project.name === "mobile" ? 360 : 1440;
      await page.setViewportSize({ width, height: 1000 });
      await f.dialog.screenshot({ path: `/tmp/app-audit-project-note-conflict-cs-${width}.png` });
    }
    expect(f.state().saved).toBe(0); await f.dialog.getByRole("button", { name: t.replaceSavedNotes, exact: true }).click(); await expect.poll(() => f.state().saved).toBe(1);
    await expect(f.dialog.getByText(t.notesConflict, { exact: true })).toHaveCount(0); await expect(f.editor).toHaveText("My retained draft");
    f.external("Latest saved note"); await f.editor.fill("Draft to discard explicitly"); await expect(f.dialog.getByText(t.notesConflict, { exact: true })).toBeVisible();
    const before = f.state().calls; await f.dialog.getByRole("button", { name: t.useSavedNotes, exact: true }).click(); await expect(f.editor).toHaveText("Latest saved note");
    await expect(f.dialog.getByText(t.notesConflict, { exact: true })).toHaveCount(0);
    await f.editor.fill("New edit after reloading"); await expect.poll(() => f.state().saved).toBe(2);
    await expect(f.dialog.getByText(t.notesSaved, { exact: true })).toBeVisible(); expect(f.state().calls).toBe(before + 1); expect(f.state().maxActive).toBe(1); expect(f.state().directWrites).toBe(0); expect(errors).toEqual([]);
  });
}

test("project links retain modified-click tabs and keyboard navigation", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "Desktop browser tab gesture; mobile flows run above.");
  const f = await fixture(page, "en"); await f.dialog.getByRole("button", { name: "Close", exact: true }).click(); await expect(f.dialog).toHaveCount(0);
  const link = page.getByRole("table", { name: projects.en.title, exact: true }).getByRole("link", { name: "Notes fixture", exact: true });
  const origin = page.url();
  const [popup] = await Promise.all([page.context().waitForEvent("page", { timeout: 10000 }), link.click({ modifiers: ["ControlOrMeta"] })]);
  try { await popup.waitForURL(/\/login$/); expect(page.url()).toBe(origin); } finally { await popup.close(); }
  await link.focus(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(/\/projects\/notes-fixture$/); await expect(page.getByRole("tabpanel")).toBeVisible();
  expect(f.state().calls).toBe(0);
});

test("long project names remain readable and separate from totals at every target width", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "The same six-width geometry matrix runs once.");
  const long = `Projekt ${"LongUnbrokenRepositoryName".repeat(7)}`, f = await fixture(page, "cs", long);
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    const title = f.dialog.getByText(long, { exact: true }), name = await title.boundingBox(), total = await f.dialog.getByText(projects.cs.perMo, { exact: true }).first().locator("..").boundingBox();
    await expect(title).toBeVisible(); expect(name!.width).toBeGreaterThanOrEqual(100);
    expect(name!.y + name!.height <= total!.y || name!.x + name!.width <= total!.x).toBe(true);
    expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await expect(f.dialog.getByRole("button", { name: projects.cs.dragHandle, exact: true })).toHaveCount(0);
});
