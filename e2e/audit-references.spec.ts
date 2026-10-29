import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { shortcuts, referenceRows } from "../src/lib/demo/fixtures";
import { shortcuts as copy } from "../src/lib/i18n/sections/shortcuts";
type AxePage=ConstructorParameters<typeof AxeBuilder>[0]["page"];
for(const lang of ["en","cs"] as const){
 test(`${lang}: References keeps failed command and table edits, with visible keyboard and touch actions`,async({page},info)=>{
  await gotoPreview(page,{lang,theme:lang==="cs"?"dark":"light"});await signInFixtureUser(page);await page.goto("/dev-preview?tab=references");
  const attempts:Record<string,number>={};const versions:string[]=[];let release!:()=>void;
  for(const table of ["shortcuts","reference_rows"]){await page.route(`**/rest/v1/${table}**`,async route=>{
   const url=new URL(route.request().url()),id=url.searchParams.get("id")?.slice(3);const seed=table==="shortcuts"?shortcuts:referenceRows;
   if(route.request().method()!=="PATCH")return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify(seed)});
   versions.push(url.searchParams.get("updated_at")??"");attempts[table]=(attempts[table]??0)+1;
   if(attempts[table]===1){if(table==="shortcuts")await new Promise<void>(r=>{release=r;});return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic write failure"}'});}
   return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...seed.find(r=>r.id===id),...route.request().postDataJSON()})});
  });}
  const command=shortcuts[0].command;const edit=page.getByRole("button",{name:`${copy[lang].edit}: ${command}`,exact:true});await expect(edit).toBeVisible();
  if(info.project.name==="mobile")expect((await edit.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await edit.focus();await page.keyboard.press("Enter");const form=page.getByRole("dialog");await page.locator("#shortcut-command").fill("git status --short");await form.getByRole("button",{name:copy[lang].save,exact:true}).click();
  await expect.poll(()=>!!release).toBe(true);await expect(page.locator("#shortcut-command")).toBeDisabled();await page.keyboard.press("Escape");await expect(form).toBeVisible();release();
  await expect(form.getByRole("alert")).toHaveText(copy[lang].couldNotSave);await expect(page.locator("#shortcut-command")).toHaveValue("git status --short");
  await form.getByRole("button",{name:copy[lang].save,exact:true}).click();await expect(form).toBeHidden();await expect(page.getByRole("button",{name:`${copy[lang].copy}: git status --short`,exact:true})).toBeVisible();
  const row=referenceRows.find(r=>r.kind==="git")!;const region=page.getByRole("region",{name:copy[lang].gitScripts,exact:true});await region.getByRole("button",{name:`${copy[lang].edit}: ${row.c1}`,exact:true}).click();
  await page.locator("#rr-git-c2").fill("Retain this reference explanation");await form.getByRole("button",{name:copy[lang].save,exact:true}).click();await expect(form.getByRole("alert")).toHaveText(copy[lang].couldNotSaveRow);
  await expect(page.locator("#rr-git-c2")).toHaveValue("Retain this reference explanation");await form.getByRole("button",{name:copy[lang].save,exact:true}).click();await expect(form).toBeHidden();await expect(region).toContainText("Retain this reference explanation");
  expect(attempts).toEqual({shortcuts:2,reference_rows:2});expect(versions.every(v=>v.startsWith("eq."))).toBe(true);
  expect((await new AxeBuilder({page:page as unknown as AxePage}).include("#main-content").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 });
}
