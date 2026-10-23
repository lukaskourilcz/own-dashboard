import { expect, test } from "@playwright/test";
import { jobs } from "../src/lib/i18n/sections/jobs";
import { gotoPreview, signInFixtureUser } from "./helpers";

test("a delayed job import preserves manual edits and cannot replace a newer URL",async ({page}) => {
 await gotoPreview(page);await page.goto("/dev-preview?tab=career");
 await page.getByRole("button",{name:/^Saved/}).click();
 const url=page.getByRole("textbox",{name:"Link",exact:true});
 await url.fill("https://jobs.example.test/first");
 let release!:()=>Promise<void>;
 await page.route("**/api/jobs/enrich",async route => {release=()=>route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({url:"https://jobs.example.test/first",title:"Imported title",company:"Imported company",description:"Imported description"})});});
 await page.getByRole("button",{name:"Fill from URL",exact:true}).click();
 await page.getByLabel("Position",{exact:true}).fill("My edited title");
 await url.fill("https://jobs.example.test/second");
 await expect.poll(()=>typeof release).toBe("function");await release();
 await expect(page.getByRole("button",{name:"Fill from URL",exact:true})).toBeEnabled();
 await expect(url).toHaveValue("https://jobs.example.test/second");
 await expect(page.getByLabel("Position",{exact:true})).toHaveValue("My edited title");
 await expect(page.getByLabel("Company",{exact:true})).toHaveValue("");
});

test("application date defaults and maximum use the saved account timezone",async ({page}) => {
 await page.clock.setFixedTime(new Date("2026-10-23T22:30:00Z"));
 await gotoPreview(page);await page.goto("/dev-preview?tab=career");
 await page.getByRole("button",{name:/Applications to send/}).click();
 await page.getByRole("button",{name:"Review / mark as sent",exact:true}).click();
 await expect(page.locator("#job-app-date")).toHaveValue("2026-10-24");
 await expect(page.locator("#job-app-date")).toHaveAttribute("max","2026-10-24");
});


test("a failed application deletion restores its recorded history",async ({page}) => {
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?tab=career");
 await page.getByRole("button",{name:/^Applied/}).click();
 const row=page.locator("#main-content").getByRole("listitem").filter({hasText:"Meridian Tools"});
 await row.getByRole("button",{name:"History",exact:true}).click();
 await expect(row.locator("ul li")).toHaveCount(2);
 await page.route("**/rest/v1/job_applications**",async route => {
   if(route.request().method()==="DELETE") await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({message:"Synthetic failure"})});
   else await route.fulfill({status:200,contentType:"application/json",body:"[]"});
 });
 await row.getByRole("button",{name:"Delete application",exact:true}).click();
 await page.getByRole("dialog").getByRole("button",{name:"Delete",exact:true}).click();
 await expect(page.getByText(jobs.en.couldNotDelete,{exact:true})).toBeVisible();
 await expect(row).toBeVisible();
 await row.getByRole("button",{name:"History",exact:true}).click();
 await expect(row.locator("ul li")).toHaveCount(2);
});
