import { test, expect, type Page, type Route } from "@playwright/test";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { projectLinks, tools } from "../src/lib/demo/fixtures";

/** A tiny PostgREST stand-in for one table, seeded with fixture rows. */
async function tableStub(page: Page, table: string, seed: Record<string, unknown>[], conflictKeys: string[] = []) {
  const rows = seed.map((row) => ({ ...row }));
  let counter = 0;
  await page.route(new RegExp(`example\\.supabase\\.co/rest/v1/${table}(\\?|$)`), async (route: Route) => {
    const request = route.request();
    const url = new URL(request.url());
    const idFilter = url.searchParams.get("id")?.replace(/^eq\./, "");
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (request.method() === "GET") return json(rows);
    if (request.method() === "DELETE") return json([]);
    const body = request.postDataJSON() as Record<string, unknown> | Record<string, unknown>[];
    const incoming = Array.isArray(body) ? body : [body];
    if (request.method() === "PATCH" && idFilter) {
      const index = rows.findIndex((row) => row.id === idFilter);
      if (index >= 0) rows[index] = { ...rows[index], ...incoming[0] };
      const single = request.headers()["accept"]?.includes("vnd.pgrst.object");
      return json(single ? rows[index] : [rows[index]]);
    }
    const saved = incoming.map((row) => {
      const existing = conflictKeys.length ? rows.findIndex((item) => conflictKeys.every((key) => item[key] === row[key])) : -1;
      const next = { id: `created-${table}-${++counter}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...(existing >= 0 ? rows[existing] : {}), ...row };
      if (existing >= 0) rows[existing] = next;
      else rows.push(next);
      return next;
    });
    const single = request.headers()["accept"]?.includes("vnd.pgrst.object");
    return json(single ? saved[0] : saved, 201);
  });
}

async function openTools(page: Page, mobile: boolean) {
  if (mobile) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Tools", exact: true }).click();
  } else {
    await page.locator("aside nav").getByRole("button", { name: "Tools", exact: true }).click();
  }
}

test("Tools lists tools in use with per-project notes, adds one and retires one", async ({ page }, testInfo) => {
  await gotoPreview(page);
  await signInFixtureUser(page);
  await tableStub(page, "tools", tools);
  await tableStub(page, "project_links", projectLinks, ["project_id", "ai_link_id"]);
  await page.reload();
  await openTools(page, testInfo.project.name === "mobile");

  const main = page.locator("#main-content");
  await expect(main.getByRole("heading", { level: 2, name: /^In use/ })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: /^Trial/ })).toBeVisible();
  const vercel = main.locator('[data-tool-card="tool-vercel"]');
  const usedIn = vercel.getByRole("list", { name: "Used in: Vercel" });
  await expect(usedIn).toContainText("DNESKAi — Hosts the static magazine.");
  await expect(usedIn).toContainText("devShark — Hosts the React client and the twelve API handlers.");
  await expect(main.locator('[data-tool-card="tool-figma"]')).toContainText("/mo");

  // Project filter.
  await main.getByRole("combobox", { name: "Filter by project" }).click();
  await page.getByRole("option", { name: "own-dashboard", exact: true }).click();
  await expect(main.locator("[data-tool-card]")).toHaveCount(1);
  await expect(main.locator('[data-tool-card="tool-supabase"]')).toBeVisible();
  await main.getByRole("combobox", { name: "Filter by project" }).click();
  await page.getByRole("option", { name: "All projects", exact: true }).click();

  // Add a tool from the library with a note for DNESKAi.
  await page.getByRole("button", { name: "Add tool", exact: true }).first().click();
  const picker = page.getByRole("dialog", { name: "Choose a library link" });
  await expect(picker.getByText("Vercel", { exact: true })).toHaveCount(0);
  await picker.getByRole("radio", { name: /Google Search Console/ }).check();
  await picker.getByRole("button", { name: "Add 1", exact: true }).click();
  const form = page.getByRole("dialog", { name: "New tool: Google Search Console" });
  await form.getByLabel("What it does", { exact: true }).fill("Shows which pages are indexed and why others are not.");
  await form.getByRole("combobox", { name: "Add project" }).click();
  await page.getByRole("option", { name: "DNESKAi", exact: true }).click();
  await form.getByLabel("DNESKAi", { exact: true }).fill("Checks each daily edition gets indexed.");
  await form.getByRole("button", { name: "Save", exact: true }).click();
  await expect(form).toBeHidden();
  const added = main.locator("[data-tool-card]").filter({ hasText: "Google Search Console" });
  await expect(added).toContainText("DNESKAi — Checks each daily edition gets indexed.");

  // Retire the trial tool.
  await main.getByRole("button", { name: "Mark retired: Figma", exact: true }).click();
  await expect(main.getByRole("heading", { level: 2, name: /^Retired/ })).toBeVisible();
  await expect(main.getByRole("heading", { level: 2, name: /^Trial/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  // Back to the library card.
  await vercel.getByRole("button", { name: "Show in Links: Vercel", exact: true }).click();
  const toggle = page.locator('[data-link-card="al4"]').getByRole("button", { name: /Vercel/ }).first();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(page.locator('[data-link-card="al4"]').getByText("Tool", { exact: true })).toBeVisible();
});

test("Tools lists what the repositories use, marked as detected and never twice", async ({ page }, testInfo) => {
  await gotoPreview(page);
  await openTools(page, testInfo.project.name === "mobile");
  const main = page.locator("#main-content");
  const detected = main.locator('section[aria-labelledby="tools-detected"]');
  await expect(detected.getByRole("heading", { level: 2, name: /^Found in repositories/ })).toBeVisible();

  // Vercel and Supabase were added by hand: their cards name the repositories
  // and the detected list leaves them out.
  await expect(main.locator('[data-tool-card="tool-vercel"] [data-tool-detected-in]')).toHaveText("Also listed in the repositories of own-dashboard, boardlessAI");
  await expect(detected.locator('[data-detected-tool="vercel"]')).toHaveCount(0);
  await expect(detected.locator('[data-detected-tool="supabase"]')).toHaveCount(0);

  // DNESKAi's `next` package and the "Next.js" two projects name are one tool.
  const nextJs = detected.locator('[data-detected-tool="next"]');
  await expect(nextJs.getByRole("heading", { level: 3 })).toHaveText("Next.js");
  await expect(nextJs.getByRole("list", { name: "Used in: Next.js" })).toHaveText(/DNESKAi\s*own-dashboard\s*boardlessAI/);
  await expect(nextJs).toContainText("Auto-detected · package.json, about-project.md");
  await expect(detected.getByRole("heading", { level: 3, name: /^next/i })).toHaveCount(1);

  // The repository list explains the projects that contributed nothing.
  await detected.getByText("Repositories: 4 of 9 active projects read").click();
  await expect(detected.locator('[data-repository-status="inherited"]').first()).toContainText("Part of the boardlessAI repository");
  await expect(detected.locator('[data-repository-status="no-repository"]')).toHaveCount(3);

  // One project, then a word.
  await main.getByRole("combobox", { name: "Filter by project" }).click();
  await page.getByRole("option", { name: "devShark", exact: true }).click();
  await expect(detected.locator("[data-detected-tool]")).toHaveCount(3);
  await main.getByRole("combobox", { name: "Filter by project" }).click();
  await page.getByRole("option", { name: "All projects", exact: true }).click();
  await main.getByRole("textbox", { name: "Filter tools" }).fill("stripe");
  await expect(detected.locator("[data-detected-tool]")).toHaveCount(1);
  await expect(detected.locator('[data-detected-tool="stripe"]')).toBeVisible();
  await main.getByRole("textbox", { name: "Filter tools" }).fill("nothing like this");
  await expect(detected.getByText("No tool found in the repositories matches.")).toBeVisible();

  // The preview has no repositories to read again.
  await expect(detected.getByRole("button", { name: "Check the repositories again" })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("Czech Tools reads Nástroje and works at 360 px", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the width is set explicitly");
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await page.getByTestId("mobile-nav").getByRole("button", { name: "Více", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Nástroje", exact: true }).click();
  await expect(page.locator("header").getByRole("heading", { level: 1, name: "Nástroje" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Používá se/ })).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /^Zjištěno z repozitářů/ })).toBeVisible();
  await expect(page.locator('[data-detected-tool="next"]')).toContainText("Zjištěno automaticky");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});
