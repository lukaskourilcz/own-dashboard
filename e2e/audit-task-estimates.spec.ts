import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole } from "./helpers";
import { todos } from "../src/lib/i18n/sections/todos";
for(const lang of ["en","cs"] as const) test(`${lang}: task estimates refuse values outside the database range before any write`,async({page})=>{
  const errors=watchConsole(page),t=todos[lang];await gotoPreview(page,{lang,theme:lang==="cs"?"dark":"light"});await page.goto("/dev-preview?tab=tasks");
  let writes=0;page.on("request",request=>{if(request.url().includes("/rest/v1/todos")&&request.method()!=="GET")writes++;});
  await page.getByRole("button",{name:t.addTask,exact:true}).click();const dialog=page.getByRole("dialog");await dialog.getByLabel(t.taskLabel,{exact:true}).fill("Retained estimate fixture");
  const input=dialog.getByRole("spinbutton",{name:t.timeLabel,exact:true});
  for(const [value,reason]of [["100001","rangeOverflow"],["0","rangeUnderflow"],["1.5","stepMismatch"]]as const){
    await input.fill(value);await dialog.getByRole("button",{name:t.addTask,exact:true}).click();expect(await input.evaluate((element,key)=>(element as HTMLInputElement).validity[key],reason)).toBe(true);
    await expect(dialog.getByLabel(t.taskLabel,{exact:true})).toHaveValue("Retained estimate fixture");expect(writes).toBe(0);
  }
  await input.fill("100000");expect(await input.evaluate(element=>(element as HTMLInputElement).validity.valid)).toBe(true);await input.fill("");expect(await input.evaluate(element=>(element as HTMLInputElement).validity.valid)).toBe(true);
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"]}).include('[role="dialog"]').withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
