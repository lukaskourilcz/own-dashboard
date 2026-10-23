import { test, expect } from "@playwright/test";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { aiLinks, aiCategories } from "../src/lib/demo/fixtures";
import { ai } from "../src/lib/i18n/sections/ai";
import { tips } from "../src/lib/i18n/sections/tips";

for(const lang of ["en","cs"] as const){
 test(`${lang}: late auto-fill preserves newer fields and sends only the URL`,async({page})=>{
  await gotoPreview(page,{lang});await page.goto("/dev-preview?tab=links");let release!:()=>void;let body:unknown;
  await page.route("**/api/ai-links/enrich",async route=>{body=route.request().postDataJSON();await new Promise<void>(resolve=>{release=resolve;});await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({title:"Upstream title",description:"Upstream description"})});});
  await page.getByRole("button",{name:ai[lang].addLink,exact:true}).first().click();const dialog=page.getByRole("dialog");
  await page.locator("#ai-url").fill("https://example.test");await dialog.getByRole("button",{name:ai[lang].autoFill,exact:true}).click();
  await expect.poll(()=>!!release).toBe(true);await page.locator("#ai-name").fill("Newer typed title");await page.locator("#ai-description").fill("Newer typed description");
  release();await expect(dialog.getByRole("button",{name:ai[lang].autoFill,exact:true})).toBeEnabled();
  await expect(page.locator("#ai-name")).toHaveValue("Newer typed title");await expect(page.locator("#ai-description")).toHaveValue("Newer typed description");
  expect(body).toEqual({url:"https://example.test/"});
 });
 test(`${lang}: a failed link save retains its draft and protects pending fields`,async({page})=>{
  await gotoPreview(page,{lang});await signInFixtureUser(page);await page.goto("/dev-preview?tab=links");let release!:()=>void;let attempts=0;
  await page.route("**/rest/v1/ai_links**",async route=>{
   if(route.request().method()!=="PATCH")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
   if(++attempts===1){await new Promise<void>(r=>{release=r;});return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic failure"}'});}
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...aiLinks.find(r=>r.id==="al1"),...route.request().postDataJSON()})});
  });
  await page.getByRole("button",{name:`${ai[lang].edit}: Midjourney`,exact:true}).click();const form=page.getByRole("dialog");
  await page.locator("#ai-description").fill("Retain this changed description");await form.getByRole("button",{name:ai[lang].save,exact:true}).click();
  await expect.poll(()=>!!release).toBe(true);await expect(page.locator("#ai-description")).toBeDisabled();await page.keyboard.press("Escape");await expect(form).toBeVisible();
  release();await expect(form.getByRole("alert")).toHaveText(ai[lang].couldNotSave);await expect(page.locator("#ai-description")).toHaveValue("Retain this changed description");
  await form.getByRole("button",{name:ai[lang].save,exact:true}).click();await expect(form).toBeHidden();expect(attempts).toBe(2);
 });
 test(`${lang}: category merge failure retains the source until an atomic retry confirms`,async({page})=>{
  await gotoPreview(page,{lang});await signInFixtureUser(page);await page.goto("/dev-preview?tab=links");let attempts=0;const payloads:Record<string,unknown>[]=[];
  await page.route("**/rest/v1/rpc/merge_library_category",async route=>{
   const body=route.request().postDataJSON();payloads.push(body);
   if(++attempts===1)return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic transaction failure"}'});
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({source_id:body.p_source_id,target_id:body.p_target_id,moved_ids:body.p_expected_link_ids})});
  });
  const source=aiCategories[0];await page.getByRole("button",{name:`${ai[lang].mergeCategory}: ${source.name}`,exact:true}).click();const form=page.getByRole("dialog");
  await form.getByRole("button",{name:ai[lang].mergeCategoryAction,exact:true}).click();await expect(form.getByRole("alert")).toHaveText(ai[lang].couldNotMerge);
  await expect(page.getByRole("button",{name:`${ai[lang].mergeCategory}: ${source.name}`,exact:true,includeHidden:true})).toBeAttached();
  await form.getByRole("button",{name:ai[lang].mergeCategoryAction,exact:true}).click();await expect(form).toBeHidden();expect(payloads[1]).toEqual(payloads[0]);
  expect(payloads[0].p_expected_link_ids).toEqual(aiLinks.filter(r=>r.category_id===source.id).map(r=>r.id));
 });
 test(`${lang}: a failed tip edit retains its draft for retry`,async({page})=>{
  await gotoPreview(page,{lang});await signInFixtureUser(page);await page.goto("/dev-preview?tab=ig-tips");let attempts=0;
  await page.route("**/rest/v1/ai_links**",async route=>{
   if(route.request().method()!=="PATCH")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
   if(++attempts===1)return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic failure"}'});
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...aiLinks.find(r=>r.id==="tip1"),...route.request().postDataJSON()})});
  });
  await page.locator('[data-tip-card="tip1"]').getByRole("button",{name:/^(Edit|Upravit):/}).click();const form=page.getByRole("dialog");
  await page.locator("#tip-summary").fill("Retain this changed summary");await form.getByRole("button",{name:tips[lang].save,exact:true}).click();
  await expect(form.getByRole("alert")).toHaveText(tips[lang].couldNotSave);await expect(page.locator("#tip-summary")).toHaveValue("Retain this changed summary");
  await form.getByRole("button",{name:tips[lang].save,exact:true}).click();await expect(form).toBeHidden();expect(attempts).toBe(2);
 });
}
