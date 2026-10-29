import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";
import { finances } from "../src/lib/i18n/sections/finances";
type AxePage=ConstructorParameters<typeof AxeBuilder>[0]["page"];
for(const lang of ["en","cs"] as const){
 test(`${lang}: a failed payment match keeps its invoice selection and protects concurrent actions`,async({page})=>{
  await gotoPreview(page,{lang});await page.goto("/dev-preview?tab=transactions");await page.getByText(finances[lang].importAndMatch,{exact:true}).click();
  const button=page.getByRole("button",{name:new RegExp(`^${finances[lang].matching.link} —`)}).first();
  const row=button.locator("..");const select=row.getByRole("combobox");await select.click();await page.getByRole("option").first().click();
  let release!:()=>void;let attempts=0;
  await page.route("**/api/money/payment-match",async route=>{
   if(++attempts===1){await new Promise<void>(r=>{release=r;});return route.fulfill({status:409,contentType:"application/json",body:'{"error":"Synthetic stale source"}'});}
   return route.fulfill({status:200,contentType:"application/json",body:'{"ok":true,"linked":1,"paidOn":"2026-10-20"}'});
  });
  await button.click();await expect.poll(()=>!!release).toBe(true);await expect(select).toBeDisabled();await expect(page.getByRole("button",{name:finances[lang].matching.matchNow,exact:true})).toBeDisabled();
  release();await expect(page.getByText(finances[lang].matching.linkErr,{exact:true})).toBeVisible();await expect(select).toBeEnabled();await expect(select).toContainText("2026001");
  await button.click();await expect(page.getByText(finances[lang].matching.linkDone,{exact:true})).toBeVisible();expect(attempts).toBe(2);
  expect((await new AxeBuilder({page:page as unknown as AxePage}).include("#main-content").withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
 });
}
