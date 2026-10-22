import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { marketingWorkspace } from "../src/lib/i18n/sections/marketing-workspace";
import { knowledgeImportCopy } from "../src/lib/marketing/knowledge-copy";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

for (const lang of ["en", "cs"] as const) {
  test(`authentic empty Marketing workspace is readable, read-only and accessible (${lang})`, async ({ page }, info) => {
    const errors = watchConsole(page);
    const writes: string[] = [];
    page.on("request", (request) => {
      if (/\/api\/marketing\//.test(request.url()) && ["POST", "PUT", "PATCH", "DELETE"].includes(request.method())) writes.push(request.url());
    });
    if (info.project.name === "mobile") await page.setViewportSize({ width: 360, height: 800 });
    await gotoPreview(page, { lang });
    await page.goto("/dev-preview?tab=marketing");
    const copy = marketingWorkspace[lang];
    const tabs = page.getByRole("tablist", { name: copy.title });
    await expect(tabs).toBeVisible();
    await expect(page.getByText(copy.preview, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.empty, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: copy.refresh, exact: true })).toBeDisabled();
    await page.getByText(lang === 'cs' ? 'Převzít připravené návrhy' : 'Import prepared drafts', { exact: true }).click();
    await expect(page.getByLabel(lang === 'cs' ? 'Připravené soubory pro import' : 'Prepared import files')).toBeDisabled();
    const jobHealth = page.getByRole('region', { name: lang === 'cs' ? 'Příprava návrhů' : 'Draft preparation' });
    await expect(jobHealth).toBeVisible();
    await expect(jobHealth.getByRole('button', { name: lang === 'cs' ? 'Zkontrolovat stav znovu' : 'Check status again' })).toBeDisabled();
    await expect(jobHealth.getByText(lang === 'cs' ? 'Pro tuto značku nejsou zaznamenané úlohy přípravy.' : 'No preparation jobs recorded for this brand.')).toBeVisible();
    await expect(page.locator("#marketing-panel-review article")).toHaveCount(0);
    await expect(page.getByRole("button", { name: copy.approve, exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect.poll(async()=>page.locator('#marketing-tab-review').evaluate(element=>{for(let node:Element|null=element;node;node=node.parentElement){if(Number(getComputedStyle(node).opacity)<1)return false;}return true;})).toBe(true);
    const reviewAxe = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    expect(reviewAxe.violations, `${lang}/review/${info.project.name}`).toEqual([]);
    for (const key of ["calendar", "knowledge", "results"] as const) {
      await tabs.getByRole("tab", { name: copy[key], exact: true }).click();
      const panel = page.locator(`#marketing-panel-${key}`);
      await expect(panel).toBeVisible();
      if (key === "calendar") {
        await expect(panel.getByText(copy.noCalendar, { exact: true })).toBeVisible();
        await expect(panel.getByRole("combobox")).toBeDisabled();
        await expect(panel.locator('input[type="date"]')).toBeDisabled();
        await expect(panel.getByRole("button", { name: lang === "cs" ? "Zkontrolovat přesun" : "Preview migration", exact: true })).toBeDisabled();
      }
      if (key === "knowledge") {
        const knowledge = knowledgeImportCopy[lang];
        await expect(panel.getByRole("heading", { name: knowledge.title, exact: true })).toBeVisible();
        const controls = panel.locator("input, textarea, select");
        expect(await controls.count()).toBeGreaterThan(0);
        for (const control of await controls.all()) await expect(control).toBeDisabled();
        await expect(panel.getByRole("button", { name: knowledge.preview, exact: true })).toBeDisabled();
        await expect(panel.getByRole("button", { name: knowledge.normalize, exact: true })).toBeDisabled();
      }
      if (key === "results") {
        await expect(panel.getByText(copy.noResults, { exact: true })).toBeVisible();
        await expect(panel.getByTestId('weekly-results')).toBeVisible();
        await expect(panel.getByRole('heading', { name: lang === 'cs' ? 'Týdenní přehled publikování' : 'Weekly publication review' })).toBeVisible();
        await expect(panel.getByText(lang === 'cs' ? 'Není změřeno' : 'Not collected', { exact: true })).toHaveCount(4);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      const axe = await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations, `${lang}/${key}/${info.project.name}`).toEqual([]);
    }
    if(lang==="cs")await page.screenshot({path:`/tmp/marketing-own-dashboard-${info.project.name}.png`,fullPage:true});
    expect(writes).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test("Marketing tabs expose roving focus and Arrow/Home/End keyboard controls", async ({ page }) => {
  await gotoPreview(page);
  await page.goto("/dev-preview?tab=marketing");
  const review = page.locator("#marketing-tab-review");
  await review.focus();
  await expect(review).toBeFocused();
  await review.press("ArrowRight");
  await expect(page.locator("#marketing-tab-calendar")).toBeFocused();
  await expect(page.locator("#marketing-tab-calendar")).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("End");
  await expect(page.locator("#marketing-tab-results")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(review).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(page.locator("#marketing-tab-results")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(review).toBeFocused();
  await expect(page.locator('[role="tab"][id^="marketing-tab-"][tabindex="0"]')).toHaveCount(1);
  await expect(page.locator("#marketing-panel-review")).toHaveAttribute("aria-labelledby", "marketing-tab-review");
});

test("Marketing APIs reject unauthenticated decisions, worker jobs and retired n8n routes without writes", async ({ request }) => {
  const results = await Promise.all([
    request.get("/api/marketing/state"),
    request.post("/api/marketing/revisions", { headers:{Origin:"http://localhost:3939"}, data: { action: "approve", id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", expectedHash: "a".repeat(64) } }),
    request.post("/api/marketing/knowledge", { headers:{Origin:"http://localhost:3939"}, data: { action: "preview" } }),
    request.post("/api/marketing/jobs", { data: {} }),
    request.post("/api/marketing/offline-import", { headers:{Origin:"http://localhost:3939"}, data: {} }),
  ]);
  for (const result of results) {
    expect(result.status(), result.url()).toBe(401);
    expect((await result.json()).error).toBe("unauthorized");
  }
  // The retired n8n entry points answer 410 to everyone, before any credential check (audit finding cost-06).
  for (const path of ["/api/marketing/n8n", "/api/marketing/dneskai/collect"]) {
    const retired = await request.post(path, { headers: { Authorization: "Bearer test-only-invalid-token" }, data: { operation: "publish", brand: "devshark", dryRun: false } });
    expect(retired.status(), path).toBe(410);
    expect(await retired.json()).toEqual({ code: "route-retired" });
  }
});
