import { test, expect } from "@playwright/test";
import { gotoPreview, watchConsole } from "./helpers";
import { todos } from "../src/lib/i18n/sections/todos";
for(const lang of ["en","cs"]as const) test(`${lang}: server shell stays visibly busy and inert until its handlers are hydrated`,async({page},info)=>{
  const width=info.project.name==="mobile"?360:1440;await page.setViewportSize({width,height:1000});
  const errors=watchConsole(page);await gotoPreview(page,{lang,theme:lang==="cs"?"dark":"light"});
  let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});
  await page.route(/\/_next\/.*\.js(?:\?|$)/,async route=>{await gate;await route.continue();});
  try{
    await page.goto("/dev-preview?tab=tasks",{waitUntil:"commit"});
    const shell=page.locator('[data-dashboard-ready="false"]');await expect(shell).toBeVisible();await expect(shell).toHaveAttribute("inert","");await expect(shell).toHaveAttribute("aria-busy","true");
    await expect.poll(()=>shell.evaluate(element=>getComputedStyle(element).opacity)).toBe("0.6");
    const raw=shell.locator("button:visible").first();await expect(raw).toBeAttached();
    expect(await raw.evaluate(element=>{element.focus();return document.activeElement===element;})).toBe(false);
    expect(await raw.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===element||!!hit&&element.contains(hit);})).toBe(false);
    await expect(page.getByRole("status").filter({hasText:/^(Loading…|Načítání…)$/})).toBeVisible();
    release();const ready=page.locator('[data-dashboard-ready="true"]');await expect(ready).toBeVisible();await expect(ready).not.toHaveAttribute("inert","");await expect(ready).toHaveAttribute("aria-busy","false");
    for(const nextWidth of [360,430,768,1024,1440,1728]) {await page.setViewportSize({width:nextWidth,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
    if(lang==="cs") {await page.setViewportSize({width,height:1000});await page.screenshot({path:`/tmp/app-audit-shell-ready-cs-${width}.png`,timeout:5000});}
    // One ordinary click after readiness must open the actual form.
    await page.getByRole("button",{name:todos[lang].addTask,exact:true}).click();await expect(page.getByRole("dialog").getByLabel(todos[lang].taskLabel,{exact:true})).toBeVisible();expect(errors).toEqual([]);
  }finally{release();await page.unrouteAll({behavior:"ignoreErrors"});}
});
