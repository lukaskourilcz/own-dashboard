import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

async function openCareer(page: Page, narrow: boolean, cs = false): Promise<void> {
  const career = cs ? "Kariéra" : "Career";
  if (narrow) {
    await page.getByRole("button", { name: cs ? "Více" : "More", exact: true }).click();
    const dialog = cs ? page.getByRole("dialog") : page.getByRole("dialog", { name: "All areas" });
    await dialog.getByRole("button", { name: career, exact: true }).click();
  } else {
    await page.locator("aside").getByRole("button", { name: career, exact: true }).click();
  }
  // Career loads nothing until the check is pressed (#81).
  await page
    .getByRole("button", { name: cs ? "Zkontrolovat nové nabídky" : "Check for new offers", exact: true })
    .click();
}

test("the stage board groups every column and preserves the progress fields on a stage change", async ({ page }, info) => {
  await gotoPreview(page);
  await openCareer(page, info.project.name === "mobile");
  await page.getByRole("button", { name: /^Applied/ }).click();

  // The dense list is the default; the board is the opt-in layout.
  await page.getByRole("button", { name: "Board", exact: true }).click();
  const board = page.getByRole("region", { name: "Application stages" });
  await expect(board).toBeVisible();

  // Case-insensitive: the headings are styled uppercase and engines disagree
  // about whether text-transform reaches the accessible name.
  for (const [column, count] of [
    ["Saved", 1],
    ["Applied", 2],
    ["Interviewing", 1],
    ["Offer", 1],
    ["Closed", 1],
  ] as const) {
    const heading = board.getByRole("heading", { name: new RegExp(`^${column}\\s+${count}$`, "i") });
    await expect(heading, column).toBeVisible();
  }

  // A saved position is not an application, so the board offers the existing
  // review dialog instead of a drag into "Applied".
  await expect(board.getByRole("button", { name: "Review / mark as sent" })).toBeVisible();

  // The overdue follow-up carries a text cue, not only a colour.
  await expect(board.getByText("Follow-up due:", { exact: false })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/career-board-${info.project.name}.png`, fullPage: true });

  // Changing a stage from the board writes through the same RPC the list uses,
  // and must carry the response, follow-up and notes back unchanged — the
  // function is a whole-row update.
  let payload: Record<string, unknown> | undefined;
  await page.route("**/rest/v1/rpc/update_job_application_progress", async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: "app-2", user_id: "preview-user", listing_id: null, title: "Senior React Engineer",
        company: "Harbour Systems", url: null, source: "manual", location: "Prague", cover_letter: "",
        status: payload!.p_status, applied_on: "2026-01-01", notes: payload!.p_notes,
        next_follow_up_at: payload!.p_follow_up_at, responded_on: payload!.p_responded_on,
        response_kind: payload!.p_response_kind,
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    });
  });
  await page.getByRole("combobox", { name: /Senior React Engineer/ }).click();
  await page.getByRole("option", { name: "Interviewing", exact: true }).click();
  await expect.poll(() => payload?.p_status).toBe("interviewing");
  expect(payload!.p_id).toBe("app-2");
  expect(payload!.p_notes).toBe("Preview only. Asked about the team size; no answer yet.");
  expect(typeof payload!.p_follow_up_at).toBe("string");
  expect(payload!.p_responded_on).toBeNull();
  expect(payload!.p_response_kind).toBeNull();
});

test("the Czech stage board reflows across the supported widths", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "run the width matrix once");
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await gotoPreview(page, { lang: "cs", theme: width === 1024 ? "dark" : "light" });
    await openCareer(page, width < 768, true);
    await page.getByRole("button", { name: /^Odeslané/ }).click();
    await page.getByRole("button", { name: "Tabule", exact: true }).click();
    await expect(page.getByRole("region", { name: "Fáze přihlášek" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(1);
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations, `${width}px`).toEqual([]);
    await page.screenshot({ path: `test-results/career-board-cs-${width}.png`, fullPage: true });
  }
});
