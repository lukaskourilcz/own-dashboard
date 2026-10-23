import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, signInFixtureUser } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
type AxePage=ConstructorParameters<typeof AxeBuilder>[0]["page"];
for(const lang of ["en","cs"] as const){
 test(`${lang}: a partial CSV import retains the file and safely retries confirmed batches`,async({page})=>{
  await gotoPreview(page,{lang});await signInFixtureUser(page);await page.goto("/dev-preview?tab=transactions");await page.getByText(finances[lang].importAndMatch,{exact:true}).click();
  const saved=new Map<string,string>();let attempts=0;let release!:()=>void;const payloads:Record<string,unknown>[][]=[];
  await page.route("**/rest/v1/transactions**",async route=>{
   if(route.request().method()!=="POST")return route.fulfill({status:200,contentType:"application/json",body:"[]"});
   const rows=route.request().postDataJSON() as Record<string,unknown>[];payloads.push(rows);
   if(++attempts===2){await new Promise<void>(r=>{release=r;});return route.fulfill({status:500,contentType:"application/json",body:'{"message":"Synthetic batch failure"}'});}
   const added=[];for(const row of rows){const key=String(row.external_id);if(!saved.has(key)){const id=`audit-csv-${saved.size}`;saved.set(key,id);added.push({id});}}
   return route.fulfill({status:201,contentType:"application/json",body:JSON.stringify(added)});
  });
  const csv="Date;Amount;Currency;Description;VS\n"+Array.from({length:501},(_,n)=>`2026-10-23;1;CZK;Synthetic row ${n};2026001`).join("\n");
  await page.locator("#bank-csv-input").setInputFiles({name:"audit-statement.csv",mimeType:"text/csv",buffer:Buffer.from(csv)});
  const button=page.getByRole("button",{name:finances[lang].bank.import,exact:true});await expect(button).toBeEnabled();await button.click();await expect.poll(()=>!!release).toBe(true);
  await expect(page.getByRole("button",{name:finances[lang].bank.chooseFile,exact:true})).toBeDisabled();release();
  await expect(page.getByRole("alert").filter({hasText:finances[lang].bank.importErr})).toBeVisible();await expect(page.getByText("audit-statement.csv",{exact:true})).toBeVisible();expect(saved.size).toBe(250);
  await button.click();await expect(page.getByText(finances[lang].bank.importDone(251,250),{exact:true})).toBeVisible();expect(saved.size).toBe(501);expect(attempts).toBe(5);
  expect(payloads.every(rows=>rows.length<=250)).toBe(true);expect(payloads.flat().every(row=>String(row.external_id).startsWith("csv:v2:")&&!('source_identity' in row)&&!('legacy_external_id' in row))).toBe(true);
  await page.locator("#bank-csv-input").setInputFiles({name:"unsupported.csv",mimeType:"text/csv",buffer:Buffer.from("Date;Amount;Currency\n2026-10-23;1;USDT")});
  await expect(page.getByText(finances[lang].bank.csvRowIssue(2,finances[lang].bank.csvIssue.currency),{exact:true})).toBeVisible();await expect(button).toHaveCount(0);expect(attempts).toBe(5);
  expect((await new AxeBuilder({page:page as unknown as AxePage}).include("#main-content").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 });
}
