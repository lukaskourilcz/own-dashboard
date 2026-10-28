import { writeFileSync } from 'node:fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
type Kind='review'|'costs';
async function fail(page:Page,kind:Kind|null){await page.evaluate(value=>{const url=new URL(location.href);if(value)url.searchParams.set('workspaceReadFailure',value);else url.searchParams.delete('workspaceReadFailure');history.replaceState(history.state,'',url);},kind);}
async function open(page:Page,kind:Kind,lang:'en'|'cs',theme:'light'|'dark',failed=false){
 await page.route('**/api/vercel/analytics?**',route=>route.fulfill({json:{kind:'unconfigured'}}));
 await gotoPreview(page,{lang,theme});await page.goto('/dev-preview?project=dneskai'+(failed?'&workspaceReadFailure='+kind:''));
 if(kind==='review'){await page.getByRole('tab',{name:dneskaiWorkspace[lang].tabs.calendar,exact:true}).click();return page.getByTestId('dneskai-workspace-read');}
 await page.getByTestId('dneskai-more').click();await page.getByTestId('dneskai-more-menu').getByRole('button',{name:dneskaiWorkspace[lang].more.costs,exact:true}).click();return page.getByTestId('dneskai-more-costs');
}
async function capture(target:Locator,file:string,selectors:string[]){const box=(await target.boundingBox())!,marks=[];for(const [index,selector]of selectors.entries()){const value=(await target.locator(selector).first().boundingBox())!;marks.push({n:index+1,x:100*(value.x-box.x)/box.width,y:100*(value.y-box.y)/box.height,w:100*value.width/box.width,h:100*value.height/box.height});}await target.screenshot({path:file});writeFileSync(file.replace('.png','.json'),JSON.stringify({box,marks},null,2)+'\n');}
for(const width of [360,430,768,1024,1440,1728])for(const lang of ['en','cs']as const)for(const theme of ['light','dark']as const)for(const kind of ['review','costs']as const){
 test(`initial ${kind} read has compact accessible keyboard recovery: ${width} ${lang} ${theme}`,async({page},info)=>{
  await page.setViewportSize({width,height:1100});const errors=watchConsole(page),t=dneskaiWorkspace[lang];await open(page,kind,lang,theme,true);
  const row=page.getByTestId('dneskai-read-recovery'),button=row.getByRole('button',{name:t.refresh,exact:true});await expect(row).toBeVisible();await expect(button).toBeEnabled();
  await expect(row.getByRole('alert')).toHaveText(kind==='review'?t.unavailable:t.costs.unavailable);
  expect(await row.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const message=(await row.getByRole('alert').boundingBox())!,action=(await button.boundingBox())!;expect(action.height).toBeGreaterThanOrEqual(44);
  if(width>=640)expect(message.x+message.width).toBeLessThanOrEqual(action.x+1);else expect(Math.abs(message.width-action.width)).toBeLessThan(1);
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="dneskai-read-recovery"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  if(lang==='cs'&&theme==='dark'&&[430,1440].includes(width))await capture(row,info.outputPath(`workspace-${kind}-initial-cs-${width}.png`),['[role="alert"]','button']);
  await fail(page,null);await button.focus();await button.press('Enter');const view=page.getByTestId(kind==='review'?'dneskai-calendar':'dneskai-costs');await expect(view).toBeVisible();await expect(view.getByRole('heading',{name:kind==='review'?t.calendar.title:t.costs.title,exact:true})).toBeFocused();expect(errors).toEqual([]);
 });
}
for(const kind of ['review','costs']as const)for(const lang of ['en','cs']as const){
 test(`failed ${kind} refresh retains confirmed content with one existing refresh control: ${lang}`,async({page},info)=>{
  const width=info.project.name==='mobile'?430:1440;await page.setViewportSize({width,height:1100});const errors=watchConsole(page),t=dneskaiWorkspace[lang],panel=await open(page,kind,lang,'dark');
  const view=page.getByTestId(kind==='review'?'dneskai-calendar':'dneskai-costs');await expect(view).toBeVisible();const before=await view.getByRole('heading').allTextContents();
  await fail(page,kind);await view.getByRole('button',{name:t.refresh,exact:true}).click();const notice=page.getByTestId('dneskai-cached-read');await expect(notice).toHaveText(t.cachedUnavailable);await expect(view).toBeVisible();expect(await view.getByRole('heading').allTextContents()).toEqual(before);await expect(view.getByRole('button',{name:t.refresh,exact:true})).toHaveCount(1);await expect(page.getByTestId('dneskai-read-recovery')).toHaveCount(0);
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include(kind==='review'?'[data-testid="dneskai-workspace-read"]':'[data-testid="dneskai-more-costs"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  if(lang==='cs')await capture(kind==='review'?page.getByTestId('dneskai-workspace-read'):panel,info.outputPath(`workspace-${kind}-cached-cs-${width}.png`),['[data-testid="dneskai-cached-read"]','h2','button']);
  await fail(page,null);await view.getByRole('button',{name:t.refresh,exact:true}).click();await expect(notice).toHaveCount(0);expect(errors).toEqual([]);
 });
}
