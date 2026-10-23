import { expect,test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview,signInFixtureUser } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
import { professional } from "../src/lib/i18n/sections/professional";

test("new transaction defaults follow the form day and preserve a chosen date",async({page})=>{
 await page.clock.setFixedTime(new Date("2026-10-23T12:00:00Z"));
 await gotoPreview(page);await page.goto("/dev-preview?tab=transactions");
 const open=()=>page.getByRole("button",{name:finances.en.addTransaction,exact:true}).click();
 await open();await expect(page.locator("#tx-date")).toHaveValue("2026-10-23");
 await page.keyboard.press("Escape");await page.clock.setFixedTime(new Date("2026-10-25T12:00:00Z"));
 await open();await expect(page.locator("#tx-date")).toHaveValue("2026-10-25");
 await page.locator("#tx-date").fill("2026-11-02");await page.keyboard.press("Escape");
 await page.clock.setFixedTime(new Date("2026-10-26T12:00:00Z"));await open();
 await expect(page.locator("#tx-date")).toHaveValue("2026-11-02");
});

test("account save failure retains the named edit fields and shows a warning",async({page})=>{
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?tab=accounts");
 await page.route("**/rest/v1/accounts**",async route=>{
  if(route.request().method()==="PATCH")await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({message:"Synthetic failure"})});
  else await route.fulfill({status:200,contentType:"application/json",body:"[]"});
 });
 await page.locator("#main-content").getByRole("button",{name:"Edit",exact:true}).first().click();
 const name=page.getByRole("textbox",{name:finances.en.accountNamePlaceholder,exact:true});
 await name.fill("Revised account name");
 await page.getByRole("button",{name:"Save",exact:true}).click();
 await expect(page.getByText(professional.en.couldNotSave,{exact:true})).toBeVisible();
 await expect(name).toHaveValue("Revised account name");
 const axe=await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"]}).include("#main-content").withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
 expect(axe.violations).toEqual([]);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
