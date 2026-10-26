import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";
import {jobApplications,savedJobPositions} from "../src/lib/demo/fixtures";
import {sessionOwner} from "./owner-session-fixtures";
import {progressReceipt} from "./career-application-fixtures";

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
  const applications=jobApplications.map((row,index)=>({...row,id:`${String(index+1).padStart(8,'0')}-eeee-4eee-8eee-eeeeeeeeeeee`,user_id:sessionOwner,listing_id:null,remote:row.remote??null,organization_id:row.organization_id??null,next_follow_up_at:row.next_follow_up_at??null,cover_letter_url:row.cover_letter_url??null,request_id:null,responded_on:row.responded_on??null,response_kind:row.response_kind??null,contact_name:row.contact_name??null,contact_email:row.contact_email??null}));
  const saved=savedJobPositions.map((row,index)=>({...row,id:`${String(index+100).padStart(8,'0')}-eeee-4eee-8eee-eeeeeeeeeeee`,user_id:sessionOwner,listing_id:null,remote:row.remote??null,cover_letter_url:row.cover_letter_url??null,readiness:row.readiness??'draft'}));
  await page.route('**/rest/v1/rpc/read_career_records',route=>{const input=route.request().postDataJSON();return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='job_applications'?applications:input.p_entity==='saved_job_positions'?saved:[]}});});
  await page.goto('/dev-preview?tab=career&career=records');
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

  // A stage patch carries only the changed field and captured owner/version.
  const original=applications.find(row=>row.title==='Senior React Engineer')!;
  let payload:Record<string,unknown>|undefined;
  await page.route('**/rest/v1/rpc/update_captured_job_application',route=>{payload=route.request().postDataJSON();return route.fulfill({json:progressReceipt(original,payload!.p_patch as Record<string,unknown>)});});
  await page.getByRole('combobox',{name:/Senior React Engineer/}).click();await page.getByRole('option',{name:'Interviewing',exact:true}).click();
  await expect.poll(()=>payload?.p_patch).toEqual({status:'interviewing'});
  expect(payload).toMatchObject({p_expected_owner:sessionOwner,p_id:original.id,p_updated_at:original.updated_at});
  await expect(board.getByRole('combobox',{name:/Senior React Engineer/})).toContainText('Interviewing');
  expect(original.notes).toBe('Preview only. Asked about the team size; no answer yet.');
  expect(typeof original.next_follow_up_at).toBe('string');

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
