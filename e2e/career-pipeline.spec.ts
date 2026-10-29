import {sessionOwner} from "./owner-session-fixtures";
import {openApplication,applicationSource,applicationReceipt,progressReceipt} from "./career-application-fixtures";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

test("prepared applications expose posting and Drive links and record a sent snapshot", async ({ page }, info) => {
  const source={...applicationSource(),title:"Synthetic frontend position",company:"Example Studio",url:"https://example.com/careers/frontend",cover_letter_url:"https://docs.google.com/document/d/example-preview-only/edit",readiness:"ready" as const};
  const {store}=await openApplication(page,"en",source,false);
  await expect(page.getByText("Example Studio", { exact: false })).toBeVisible();
  await expect(page.getByRole("link", { name: "Cover letter on Google Drive" })).toHaveAttribute("href", "https://docs.google.com/document/d/example-preview-only/edit");
  await expect(page.getByRole("link", { name: "Job posting", exact: true })).toHaveAttribute("href", "https://example.com/careers/frontend");
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: `test-results/career-prepared-${info.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Review / mark as sent" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Cover letter on Google Drive")).toHaveValue("https://docs.google.com/document/d/example-preview-only/edit");
  let payload: Record<string, unknown> | undefined;
  let recorded: Record<string, unknown> | null = null;
  await page.route("**/rest/v1/job_applications**", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(recorded ? [recorded] : []),
  }));
  await page.route("**/rest/v1/rpc/record_captured_job_application", async route => {
    payload = route.request().postDataJSON();
    const receipt=applicationReceipt(source,payload!);
    recorded=receipt.row;store.saved=[];store.applications=[receipt.row];store.events=[receipt.event];
    await route.fulfill({ json:receipt });
  });
  await dialog.getByRole("button", { name: "Record sent application", exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(payload!.p_saved_id).toBe(source.id);
  expect(payload!.p_expected_owner).toBe(sessionOwner);
  expect(payload!.p_saved_updated_at).toBe(source.updated_at);
  expect((payload!.p_payload as Record<string, unknown>).listing_id).toBeUndefined();
  await page.getByRole("button", { name: /^Applied/ }).click();
  // Fixture queries stay isolated from live refetches; measure this recorded application cohort.
  await page.getByRole("textbox", { name: "Search sent applications", exact: true }).fill("Example Studio");
  const row = page.getByRole("listitem").filter({ hasText: "Example Studio" });
  await row.getByRole("button", { name: "Response / follow-up", exact: true }).click();
  const progress = page.getByRole("dialog", { name: "Response and follow-up" });
  await progress.getByLabel("First substantive response").click();
  await page.getByRole("option", { name: "Interest / invitation", exact: true }).click();
  const sent = payload!.p_payload as Record<string, unknown>;
  await progress.getByLabel("First response date").fill(sent.applied_on as string);
  await progress.getByLabel("Notes and next step").fill("Interview invitation received; arrange a time.");
  let responsePayload: Record<string, unknown> | undefined;
  await page.route("**/rest/v1/rpc/update_captured_job_application", async route => {
    responsePayload = route.request().postDataJSON();
    const receipt=progressReceipt(store.applications[0],responsePayload!.p_patch as Record<string,unknown>);
    recorded=receipt.row;store.applications=[receipt.row];store.events.push(...receipt.events);
    await route.fulfill({json:receipt});
  });
  await progress.getByRole("button", { name: "Save", exact: true }).click();
  await expect(progress).toBeHidden();
  expect((responsePayload!.p_patch as Record<string,unknown>).response_kind).toBe("positive");
  expect((responsePayload!.p_patch as Record<string,unknown>).responded_on).toBe(sent.applied_on);
  await expect(row.getByText(/First response:/)).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/career-response-${info.project.name}.png`, fullPage: true });

});


test("Czech prepared applications reflow across the supported widths", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "run the width matrix once");
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    await gotoPreview(page, { lang: "cs", theme: width === 1024 ? "dark" : "light" });
    if (width < 768) {
      await page.getByRole("button", { name: "Více", exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Kariéra", exact: true }).click();
    } else await page.locator("aside").getByRole("button", { name: "Kariéra", exact: true }).click();
    await page.getByRole("button", { name: "Zkontrolovat nové nabídky", exact: true }).click();
    await page.getByRole("button", { name: /Přihlášky k odeslání/ }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${width}px`).toBeLessThanOrEqual(1);
    await expect(page.getByRole("link", { name: "Dopis na Google Drive" })).toBeVisible();
    expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"] }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations, `${width}px`).toEqual([]);
    await page.screenshot({ path: `test-results/career-cs-${width}.png`, fullPage: true });
  }
});
