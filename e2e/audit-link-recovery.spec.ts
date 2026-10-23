import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];
import { gotoPreview, signInFixtureUser } from "./helpers";
import { ai } from "../src/lib/i18n/sections/ai";
import { tools } from "../src/lib/i18n/sections/tools";
import { projectLinks } from "../src/lib/demo/fixtures";

for (const lang of ["en", "cs"] as const) {
 test(`${lang}: a rejected picker retains its selection and retries`, async ({ page }) => {
  await gotoPreview(page, {lang}); await signInFixtureUser(page);
  await page.goto(`/dev-preview?project=dneskai&projectTab=overview`);
  let attempts=0;
  await page.route("**/rest/v1/project_links**", async route => {
   if(route.request().method()!=="POST") return route.fulfill({status:200,body:"[]",contentType:"application/json"});
   if(++attempts===1) return route.fulfill({status:500,body:'{"message":"Synthetic failure"}',contentType:"application/json"});
   return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify(route.request().postDataJSON().map((r: Record<string,unknown>)=>({...r,id:"audit-link",created_at:"2026-10-23T12:00:00Z"})))});
  });
  await page.getByRole("button",{name:lang==="en"?"Add link":"Přidat odkaz",exact:true}).click();
  const picker=page.getByRole("dialog");
  await picker.getByRole("textbox").fill("supabase");
  await picker.getByRole("checkbox",{name:/Supabase/}).check();
  await picker.getByRole("button",{name:ai[lang].pickerAdd(1),exact:true}).click();
  await expect(picker.getByRole("alert")).toHaveText(ai[lang].pickerFailed);
  await expect(picker.getByRole("checkbox",{name:/Supabase/})).toBeChecked();
  expect((await new AxeBuilder({page: page as unknown as AxePage}).include('[role="dialog"]').withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  await picker.getByRole("button",{name:ai[lang].pickerAdd(1),exact:true}).click();
  await expect(picker).toBeHidden(); expect(attempts).toBe(2);
 });
 test(`${lang}: project link failures retain the saved tool and retry an update`,async({page})=>{
  await gotoPreview(page,{lang}); await signInFixtureUser(page); await page.goto("/dev-preview?tab=tools");
  const methods:string[]=[];let attempts=0;let stored:Record<string,unknown>={};
  await page.route("**/rest/v1/tools**",async route=>{
   const method=route.request().method();if(method==="POST"||method==="PATCH"){
    methods.push(method);stored={...stored,...route.request().postDataJSON(),id:"audit-tool",created_at:"2026-10-23T12:00:00Z",updated_at:"2026-10-23T12:00:00Z"};
    return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(stored)});
   }return route.fulfill({status:200,contentType:"application/json",body:"[]"});
  });
  await page.route("**/rest/v1/project_links**",async route=>{
   if(route.request().method()!=="POST")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
   if(++attempts===1)return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic failure"}'});
   return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify(route.request().postDataJSON().map((r:Record<string,unknown>)=>({...r,id:"audit-usage",created_at:"2026-10-23T12:00:00Z"})))});
  });
  await page.getByRole("button",{name:tools[lang].addTool,exact:true}).first().click();
  const picker=page.getByRole("dialog");await picker.getByRole("radio",{name:/Google Search Console/}).check();await picker.getByRole("button",{name:ai[lang].pickerAdd(1),exact:true}).click();
  const form=page.getByRole("dialog");await form.getByRole("textbox",{name:tools[lang].whatItDoes,exact:true}).fill("Checks indexing");
  await form.getByRole("combobox",{name:tools[lang].addProject,exact:true}).click();await page.getByRole("option",{name:"DNESKAi",exact:true}).click();
  // An existing project relationship keeps its note when classified as a tool.
  await expect(form.getByRole("textbox",{name:"DNESKAi",exact:true})).not.toHaveValue("");
  await form.getByRole("textbox",{name:"DNESKAi",exact:true}).fill("Keep this project note");
  await form.getByRole("button",{name:tools[lang].save,exact:true}).click();
  await expect(form.getByRole("alert")).toHaveText(tools[lang].projectLinksFailed);
  await expect(form.getByRole("textbox",{name:"DNESKAi",exact:true})).toHaveValue("Keep this project note");
  await expect(form.getByRole("heading",{name:tools[lang].editTool,exact:true})).toBeVisible();
  await form.getByRole("button",{name:tools[lang].save,exact:true}).click();
  await expect(form).toBeHidden();expect(methods).toEqual(["POST","PATCH"]);expect(attempts).toBe(2);
 });
}

test("a failed inline note keeps its draft and retries against its source version", async ({page})=>{
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?project=dneskai&projectTab=overview");
 let attempts=0;const versions:string[]=[];
 await page.route("**/rest/v1/project_links**",async route=>{
  if(route.request().method()!=="PATCH")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
  versions.push(new URL(route.request().url()).searchParams.get("updated_at")??"");
  if(++attempts===1)return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic failure"}'});
  return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...projectLinks.find(row=>row.id===new URL(route.request().url()).searchParams.get("id")?.slice(3)),...route.request().postDataJSON()})});
 });
 const item=page.locator('[data-project-link="al6"]');await item.getByRole("button",{name:/Edit note/}).click();
 const input=item.getByRole("textbox");await input.fill("Retain the failed project note");await input.press("Enter");
 await expect(item.getByRole("alert")).toBeVisible();await expect(input).toHaveValue("Retain the failed project note");
 await input.press("Enter");await expect(input).toBeHidden();await expect(item).toContainText("Retain the failed project note");
 expect(versions).toHaveLength(2);expect(versions[0]).toMatch(/^eq\./);expect(versions[1]).toBe(versions[0]);
});

test("a rejected add-to-project request leaves the note editable for retry",async({page})=>{
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?tab=links");let attempts=0;
 await page.route("**/rest/v1/project_links**",async route=>{
  if(route.request().method()!=="POST")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
  if(++attempts===1)return route.abort("failed");
  return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify(route.request().postDataJSON().map((r:Record<string,unknown>)=>({...r,id:"audit-add",created_at:"2026-10-23T12:00:00Z"})))});
 });
 const card=page.locator('[data-link-card="al4"]');await card.getByRole("button",{name:/Show details/}).click();await card.getByRole("button",{name:"Add to project",exact:true}).click();
 const form=page.getByRole("dialog");const note=form.getByRole("textbox");await note.fill("Do not lose this note");
 await form.getByRole("button",{name:"Add to project",exact:true}).click();await expect(form.getByRole("alert")).toHaveText(ai.en.relationFailed);
 await expect(note).toBeEnabled();await expect(note).toHaveValue("Do not lose this note");
 await form.getByRole("button",{name:"Add to project",exact:true}).click();await expect(form).toBeHidden();expect(attempts).toBe(2);
});
