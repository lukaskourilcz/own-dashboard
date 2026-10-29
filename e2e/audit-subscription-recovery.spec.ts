import {expect,test} from "@playwright/test";
import {gotoPreview,signInFixtureUser} from "./helpers";
import {subscriptions} from "../src/lib/i18n/sections/subscriptions";
import {portfolio} from "../src/lib/i18n/sections/portfolio";

test("an allocation failure retries the saved subscription without inserting a duplicate",async({page})=>{
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?tab=subscriptions");
 const writes:string[]=[];let allocationAttempts=0;let stored:Record<string,unknown>={};
 await page.route("**/rest/v1/subscriptions**",async route=>{
  const method=route.request().method();
  if(method==="POST"||method==="PATCH"){
   writes.push(method);stored={...stored,...route.request().postDataJSON(),id:"audit-subscription",is_active:true,created_at:"2026-10-23T12:00:00Z",updated_at:"2026-10-23T12:00:00Z"};
   await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(stored)});
  }else await route.fulfill({status:200,contentType:"application/json",body:"[]"});
 });
 await page.route("**/rest/v1/subscription_allocations**",async route=>{
  if(route.request().method()==="POST"){
   allocationAttempts++;
   if(allocationAttempts===1)await route.fulfill({status:500,contentType:"application/json",body:JSON.stringify({message:"Synthetic allocation failure"})});
   else await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(route.request().postDataJSON().map((row:Record<string,unknown>)=>({...row,id:"audit-allocation",created_at:"2026-10-23T12:00:00Z"})))});
  }else await route.fulfill({status:200,contentType:"application/json",body:"[]"});
 });
 await page.getByRole("button",{name:subscriptions.en.addSubscription,exact:true}).click();
 const dialog=page.getByRole("dialog");
 await page.locator("#sub-name").fill("Audit subscription");await page.locator("#sub-amount").fill("12");
 await page.locator("#sub-next").fill("2026-11-01");
 await dialog.getByRole("button",{name:portfolio.en.subscription.addAllocation,exact:true}).click();
 await dialog.getByRole("spinbutton",{name:portfolio.en.subscription.share,exact:true}).fill("50");
 await dialog.getByRole("button",{name:"Add",exact:true}).click();
 await expect(dialog.getByRole("alert")).toHaveText(portfolio.en.subscription.allocationsSaveFailed);
 await expect(dialog.getByRole("heading",{name:subscriptions.en.editSubscription,exact:true})).toBeVisible();
 await expect(page.locator("#sub-name")).toHaveValue("Audit subscription");
 await dialog.getByRole("button",{name:"Save",exact:true}).click();
 await expect(dialog).toBeHidden();expect(writes).toEqual(["POST","PATCH"]);expect(allocationAttempts).toBe(2);
});
