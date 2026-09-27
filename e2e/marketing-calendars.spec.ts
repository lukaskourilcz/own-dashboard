import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

const TIP_PLAN = "Plan a month of posts around two topics";
const TIP_CAROUSEL = "Design every carousel at the 4:5 portrait ratio and keep that one ratio for every slide of the post";
const DEVSHARK = { id: "marketingshark", label: "devShark", repo: "lukaskourilcz/quorum", path: "state/marketing-calendar/marketingshark.json", calendarUrl: "https://boardless-ai.vercel.app/admin/calendar?venture=marketingshark" };
const DNESKAI = { id: "caught-up", label: "DNESKAi", repo: "lukaskourilcz/quorum", path: "state/marketing-calendar/caught-up.json", calendarUrl: "https://boardless-ai.vercel.app/admin/calendar?venture=caught-up" };

/** A local `yyyy-MM-dd`, `offset` days from today, as the browser counts days. */
function day(offset: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const entry = (id: string, offset: number, time: string, title: string, tipRefs: string[] = [], status = "planned", platform = "instagram", kind = "carousel") => ({
  id, date: day(offset), time, platform, kind, title, status, tipRefs,
});

const calendar = (extra: Record<string, unknown>) => ({ name: "x", launch: null, periodStart: null, periodEnd: null, entries: [], prelaunch: [], skipped: 0, ...extra });

/**
 * Stands in for GET /api/marketing/calendars, which reads GitHub on the
 * server. Returns the request count so a test can see "Check again" ask again.
 */
async function stubCalendars(page: Page, body: unknown, status = 200) {
  let requests = 0;
  await page.unroute("**/api/marketing/calendars");
  await page.route("**/api/marketing/calendars", (route) => {
    requests += 1;
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  });
  return () => requests;
}

async function openPreview(page: Page, query: string) {
  await gotoPreview(page);
  await page.goto(`/dev-preview?${query}`);
}

test("/ig-tips?q=<title> opens IG TIPS searching for that tip with its card expanded", async ({ page }) => {
  const errors = watchConsole(page);
  await openPreview(page, `tab=ig-tips&q=${encodeURIComponent(TIP_CAROUSEL)}`);
  const main = page.locator("#main-content");
  await expect(main.getByRole("textbox", { name: "Search tips…" })).toHaveValue(TIP_CAROUSEL);
  const card = main.locator('[data-tip-card="tip2"]');
  await expect(card.getByRole("button", { name: `Hide details: ${TIP_CAROUSEL}` })).toHaveAttribute("aria-expanded", "true");
  await expect(card.getByText("Research notes", { exact: true })).toBeVisible();
  await expect(card).toBeInViewport();
  await expect(main.locator("[data-tip-card]")).toHaveCount(1);

  // The search is an ordinary search: clearing it shows every tip.
  await main.getByRole("button", { name: "Clear filters" }).click();
  await expect(main.locator("[data-tip-card]")).toHaveCount(5);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("a deep link that names no tip exactly only prefills the search", async ({ page }) => {
  await openPreview(page, "tab=ig-tips&q=carousel");
  const main = page.locator("#main-content");
  await expect(main.getByRole("textbox", { name: "Search tips…" })).toHaveValue("carousel");
  await expect(main.locator("[data-tip-card]")).toHaveCount(1);
  await expect(main.locator('[data-tip-card="tip2"]').getByRole("button", { name: `Details: ${TIP_CAROUSEL}` })).toHaveAttribute("aria-expanded", "false");
});

test("tip cards say which plans apply them, read from the calendars, with a Not yet applied filter", async ({ page }) => {
  const errors = watchConsole(page);
  await gotoPreview(page);
  const requests = await stubCalendars(page, {
    checkedAt: new Date().toISOString(),
    sources: [
      {
        ...DEVSHARK, status: "ok", detail: null,
        calendar: calendar({
          launch: day(-3),
          entries: [
            entry("ds-001", 0, "09:00", "Carousel one", [TIP_PLAN, TIP_CAROUSEL]),
            entry("ds-002", 1, "09:00", "Carousel two", [TIP_PLAN, TIP_PLAN.toUpperCase()]),
            entry("ds-003", 2, "09:00", "Carousel three", ["A tip that is not saved here"]),
          ],
        }),
      },
      { ...DNESKAI, status: "not-found", detail: null, calendar: null },
    ],
  });
  await page.goto("/dev-preview?tab=ig-tips&calendars=live");
  const main = page.locator("#main-content");

  const plan = main.locator('[data-tip-card="tip1"]');
  await expect(plan.locator("[data-tip-usage]")).toHaveText(/^Applied in\s*devShark ×2/);
  const link = plan.getByRole("link", { name: /devShark ×2/ });
  await expect(link).toHaveAttribute("target", "_blank");
  const href = new URL((await link.getAttribute("href"))!);
  expect(href.origin + href.pathname).toBe("https://boardless-ai.vercel.app/admin/calendar");
  expect(href.searchParams.get("venture")).toBe("marketingshark");
  expect(href.searchParams.get("q")).toBe(TIP_PLAN);
  await expect(main.locator('[data-tip-card="tip2"] [data-tip-usage]')).toContainText("devShark ×1");
  await expect(main.locator('[data-tip-card="tip3"] [data-tip-usage]')).toHaveCount(0);

  const status = main.locator("[data-plans-status]");
  await expect(status).toContainText("Marketing plans: devShark (3 entries)");
  await expect(status).toContainText("Could not read lukaskourilcz/quorum/state/marketing-calendar/caught-up.json: the file is not on the default branch yet.");
  await expect(status).toContainText("1 tip title cited in the plans matches no tip here.");

  const notApplied = main.getByRole("group", { name: "Filter by topic" }).getByRole("button", { name: /^Not yet applied/ });
  await expect(notApplied).toContainText("3");
  await notApplied.click();
  await expect(notApplied).toHaveAttribute("aria-pressed", "true");
  await expect(main.locator("[data-tip-card]")).toHaveCount(3);
  await expect(main.locator('[data-tip-card="tip1"], [data-tip-card="tip2"]')).toHaveCount(0);
  await main.getByRole("button", { name: "Clear filters" }).click();
  await expect(main.locator("[data-tip-card]")).toHaveCount(5);

  await status.getByRole("button", { name: "Check the calendars again" }).click();
  await expect.poll(requests).toBe(2);
  expect(errors, errors.join("\n")).toEqual([]);
});

test("IG TIPS says when the calendars cannot be read at all", async ({ page }) => {
  await gotoPreview(page);
  await stubCalendars(page, { error: "boom" }, 500);
  await page.goto("/dev-preview?tab=ig-tips&calendars=live");
  const main = page.locator("#main-content");
  await expect(main.locator("[data-plans-status]")).toContainText("Could not read the marketing calendars. Try again.");
  await expect(main.getByRole("button", { name: /^Not yet applied/ })).toHaveCount(0);
  await expect(main.locator("[data-tip-usage]")).toHaveCount(0);
  await expect(main.locator("[data-tip-card]")).toHaveCount(5);
});

test("the Work overview lists the next seven marketing days across calendars, read-only", async ({ page }, testInfo) => {
  const errors = watchConsole(page);
  await gotoPreview(page);

  // Before the launch: the countdown and the pre-launch items due this week.
  await stubCalendars(page, {
    checkedAt: new Date().toISOString(),
    sources: [
      {
        ...DEVSHARK, status: "ok", detail: null,
        calendar: calendar({
          launch: day(38), periodStart: day(38),
          entries: [entry("ds-001", 38, "08:00", "Day 0: record baselines")],
          prelaunch: [
            { id: "ds-pre-01", due: day(-2), title: "Switch Instagram to a professional account", owner: "owner", repo: null, issue: null, status: "planned" },
            { id: "ds-pre-02", due: day(2), title: "UTM parameters kept on the first pageview", owner: "agent", repo: "lukaskourilcz/react-express-app", issue: "#239", status: "planned" },
            { id: "ds-pre-03", due: day(20), title: "Later item", owner: "owner", repo: null, issue: null, status: "planned" },
          ],
        }),
      },
      { ...DNESKAI, status: "disconnected", detail: null, calendar: null },
    ],
  });
  await page.goto("/dev-preview?tab=work&calendars=live");
  const card = page.locator("[data-marketing-week]");
  await expect(card.getByRole("heading", { name: "Marketing", exact: true })).toBeVisible();
  await expect(card.locator("[data-marketing-launch]")).toContainText("Marketing starts");
  await expect(card.locator("[data-marketing-launch]")).toContainText("in 38 days");
  await expect(card.locator("[data-marketing-prelaunch]")).toHaveCount(2);
  const overdue = card.locator('[data-marketing-prelaunch="ds-pre-01"]');
  await expect(overdue).toContainText("Overdue");
  await expect(overdue).toContainText("devShark · Owner");
  await expect(card.locator('[data-marketing-prelaunch="ds-pre-02"]').getByRole("link")).toHaveAttribute("href", "https://github.com/lukaskourilcz/react-express-app/issues/239");
  await expect(card.locator("[data-marketing-entry]")).toHaveCount(0);
  await expect(card.locator('[data-calendar-problem="caught-up"]')).toHaveText("Could not read lukaskourilcz/quorum/state/marketing-calendar/caught-up.json: GitHub is not connected.");
  await expect(card.getByRole("link", { name: /Open the devShark calendar/ })).toHaveAttribute("href", DEVSHARK.calendarUrl);
  if (testInfo.project.name === "desktop") {
    // Let the tab's entrance transition settle, as the a11y suite does.
    await page.waitForTimeout(600);
    const { violations } = await new AxeBuilder({ page: page as unknown as AxePage }).include("[data-marketing-week]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(violations).toEqual([]);
  }

  // After the launch: seven days of entries in date and time order, each linking to its calendar entry.
  await stubCalendars(page, {
    checkedAt: new Date().toISOString(),
    sources: [
      {
        ...DEVSHARK, status: "ok", detail: null,
        calendar: calendar({
          launch: day(-1),
          entries: [
            entry("ds-009", 8, "09:00", "Outside the window"),
            entry("ds-002", 0, "17:30", "Five interview questions", [], "drafted"),
            entry("ds-004", 1, "18:00", "Blocked reel", [], "blocked", "instagram", "reel"),
            entry("ds-001", -1, "08:00", "Yesterday"),
            entry("ds-003", 6, "12:00", "Last day of the window", [], "queued", "threads", "thread"),
          ],
        }),
      },
      { ...DNESKAI, status: "ok", detail: null, calendar: calendar({ launch: day(-1), entries: [entry("dn-001", 0, "07:30", "Today's edition in five slides", [], "published")] }) },
    ],
  });
  await page.reload();
  await expect(card.locator("[data-marketing-entry]")).toHaveCount(4);
  await expect(card.locator("[data-marketing-entry]").nth(0)).toContainText("Today's edition in five slides");
  await expect(card.locator("[data-marketing-entry]").nth(0)).toContainText("07:30 · DNESKAi · Instagram · Carousel");
  await expect(card.locator("[data-marketing-entry]").nth(0)).toContainText("Published");
  await expect(card.locator("[data-marketing-entry]").nth(1)).toContainText("Drafted");
  await expect(card.locator("[data-marketing-entry]").nth(2)).toContainText("Blocked");
  await expect(card.locator("[data-marketing-entry]").nth(3)).toContainText("12:00 · devShark · Threads · Thread");
  const entryLink = new URL((await card.locator('[data-marketing-entry="ds-002"]').getByRole("link").getAttribute("href"))!);
  expect(entryLink.searchParams.get("venture")).toBe("marketingshark");
  expect(entryLink.searchParams.get("entry")).toBe("ds-002");
  expect(entryLink.searchParams.get("week")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await expect(card.locator("[data-marketing-launch]")).toHaveCount(0);
  await expect(card.locator("[data-calendar-problem]")).toHaveCount(0);
  // Read-only: nothing in the block edits a plan.
  await expect(card.getByRole("textbox")).toHaveCount(0);
  await expect(card.getByRole("checkbox")).toHaveCount(0);

  if (testInfo.project.name === "desktop") {
    // Let the tab's entrance transition settle, as the a11y suite does.
    await page.waitForTimeout(600);
    const { violations } = await new AxeBuilder({ page: page as unknown as AxePage }).include("[data-marketing-week]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(violations).toEqual([]);
  }

  // Nothing in the window and no launch ahead.
  await stubCalendars(page, {
    checkedAt: new Date().toISOString(),
    sources: [{ ...DEVSHARK, status: "ok", detail: null, calendar: calendar({ launch: day(-20), entries: [entry("ds-001", -20, "08:00", "Old")] }) }],
  });
  await page.reload();
  await expect(card).toContainText("Nothing is planned in the next seven days.");

  // No calendar readable, then no answer at all.
  await stubCalendars(page, { checkedAt: new Date().toISOString(), sources: [{ ...DEVSHARK, status: "error", detail: "502", calendar: null }] });
  await page.reload();
  await expect(card).toContainText("GitHub answered 502.");
  await expect(card).toContainText("No marketing calendar could be read, so the week's plan is unknown.");
  await stubCalendars(page, { error: "boom" }, 500);
  await page.reload();
  await expect(card.getByRole("alert")).toHaveText("Could not read the marketing calendars. Try again.");
  // A 500 is logged by the browser as a failed resource; nothing else may be.
  expect(errors.filter((error) => !error.includes("500")), errors.join("\n")).toEqual([]);
});

test("the preview shows the fixture calendars in Czech at 360 px without overflow", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === "mobile", "the width is set explicitly");
  await page.setViewportSize({ width: 360, height: 800 });
  await gotoPreview(page, { lang: "cs", theme: "dark" });
  await page.goto("/dev-preview?tab=work");
  const card = page.locator("[data-marketing-week]");
  await expect(card.locator("[data-marketing-launch]")).toContainText("Marketing začíná");
  await expect(card.locator("[data-marketing-launch]")).toContainText(/za \d+ dn(y|í) · DNESKAi/);
  await expect(card.locator('[data-marketing-prelaunch="dn-pre-01"]')).toContainText("Po termínu");
  await expect(card.locator('[data-marketing-entry="ds-002"]')).toContainText("Karusel");
  await expect(card.locator('[data-marketing-entry="ds-002"]')).toContainText("Koncept");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);

  await page.goto("/dev-preview?tab=ig-tips");
  const usage = page.locator('[data-tip-card="tip1"] [data-tip-usage]');
  await expect(usage).toContainText("Použito v");
  await expect(usage.getByRole("link")).toHaveText(["devShark ×3 (otevře se na nové kartě)", "DNESKAi ×1 (otevře se na nové kartě)"]);
});
