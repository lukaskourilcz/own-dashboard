import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { projects as fixtures } from '../src/lib/demo/fixtures';
import { dneskaiDailyMix } from '../src/lib/i18n/sections/dneskai-daily-mix';
import { dneskaiSourceList } from '../src/lib/i18n/sections/dneskai-source-list';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { dneskaiRegistrySourceList } from '../src/lib/marketing/dneskai-source-list';
import { common } from '../src/lib/i18n/sections/common';
const id='22222222-2222-4222-8222-222222222222',owner='11111111-1111-4111-8111-111111111111';
async function fixture(page: Page,lang:'en'|'cs') {
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 const project={...fixtures.find(row=>row.slug==='dneskai')!,id,user_id:owner};
 let read={mix:{newsPerDay:1,educationPerDay:1,slots:['08:00','17:00']},stored:true,version:'2026-10-24T17:10:00.123456Z'};
 let calls=0,fail=false,hold=false,release:(()=>void)|undefined;
 await page.route('**/rest/v1/rpc/read_owned_collection',route=>route.fulfill({json:route.request().postDataJSON().p_entity==='projects'?[project]:[]}));
 await page.route('**/api/marketing/dneskai/source-list?**',route=>route.fulfill({json:dneskaiRegistrySourceList()}));
 await page.route('**/api/marketing/dneskai/daily-mix?**',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:read});
  calls++;const input=route.request().postDataJSON();expect(Object.keys(input).sort()).toEqual(['expectedVersion','mix']);
  if(hold)await new Promise<void>(resolve=>{release=resolve;});release=undefined;
  if(fail)return route.fulfill({status:503,json:{error:'synthetic-private-upstream-detail'}});
  const sourceVersion=read.version;
  if(input.expectedVersion!==sourceVersion)return route.fulfill({status:409,json:{kind:'conflict',ownerId:owner,projectId:id,sourceVersion,read}});
  read={mix:input.mix,stored:true,version:'2026-10-24T17:10:01.123456Z'};
  return route.fulfill({json:{kind:'saved',ownerId:owner,projectId:id,sourceVersion,read}});
 });
 await page.goto('/dev-preview?tab=projects&projectRecords=live');
 await page.locator('#main-content').getByRole('link',{name:'DNESKAi',exact:true}).first().click();
 await page.getByRole('tab',{name:lang==='cs'?'Zdroje (DNESKAi)':'Sources (DNESKAi)',exact:true}).click();
 await page.getByRole('tab',{name:dneskaiDailyMix[lang].title,exact:true}).click();
 const panel=page.getByTestId('dneskai-daily-mix');await expect(panel.getByRole('combobox',{name:dneskaiDailyMix[lang].news,exact:true})).toHaveValue('1');
 return {panel,calls:()=>calls,fail:(value:boolean)=>{fail=value;},hold:(value:boolean)=>{hold=value;},
  release:async()=>{await expect.poll(()=>typeof release).toBe('function');release!();},
  external:()=>{read={...read,mix:{...read.mix,newsPerDay:0},version:'2026-10-24T17:10:00.123457Z'};}};
}
for(const lang of ['en','cs'] as const) {
 test(`${lang}: pending and failed mix saves retain the draft and protect navigation`,async({page})=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=dneskaiDailyMix[lang],guardCopy=common[lang].unsaved;
  await f.panel.getByRole('combobox',{name:t.education,exact:true}).selectOption('0');f.fail(true);f.hold(true);
  await f.panel.getByRole('button',{name:t.save,exact:true}).click();await expect.poll(f.calls).toBe(1);
  await f.panel.locator('form').dispatchEvent('submit');expect(f.calls()).toBe(1);
  await page.getByRole('tab',{name:dneskaiAudio[lang].title,exact:true}).click();
  const guard=page.getByRole('dialog');await expect(guard.getByRole('heading')).toHaveText(guardCopy.pendingTitle);await expect(guard.getByRole('button',{name:guardCopy.discard,exact:true})).toBeDisabled();
  await f.release();await expect(f.panel.locator('[role="alert"]')).toHaveText(t.failed);
  await guard.getByRole('button',{name:guardCopy.stay,exact:true}).click();await expect(f.panel.getByRole('combobox',{name:t.education,exact:true})).toHaveValue('0');
  f.hold(false);f.fail(false);await f.panel.getByRole('button',{name:t.save,exact:true}).click();await expect(f.panel.getByRole('status')).toHaveText(t.saved);expect(f.calls()).toBe(2);
  await page.getByRole('tab',{name:dneskaiSourceList[lang].title,exact:true}).click();await expect(f.panel).toHaveCount(0);await expect(guard).toHaveCount(0);
  expect(errors.filter(error=>!error.includes('/api/marketing/dneskai/daily-mix')||!error.includes('503'))).toEqual([]);
 });
 test(`${lang}: a changed mix keeps local edits until explicit reload`,async({page},info)=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=dneskaiDailyMix[lang];
  await f.panel.getByRole('combobox',{name:t.education,exact:true}).selectOption('0');f.external();await f.panel.getByRole('button',{name:t.save,exact:true}).click();
  await expect(f.panel.getByRole('button',{name:t.reload,exact:true})).toBeVisible();await expect(f.panel.getByRole('combobox',{name:t.education,exact:true})).toHaveValue('0');await expect(f.panel.getByRole('combobox',{name:t.news,exact:true})).toHaveValue('1');await expect(f.panel.getByRole('button',{name:t.save,exact:true})).toBeDisabled();
  for(const width of [360,430,768,1024,1440,1728]) {await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);for(const control of await f.panel.locator('select,button[type="submit"]').all())await expect.poll(async()=>(await control.boundingBox())!.height).toBeGreaterThanOrEqual(width<768?44:32);}
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="dneskai-daily-mix"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:info.project.name==='mobile'?360:1440,height:1000});if(lang==='cs')await f.panel.screenshot({path:`/tmp/app-audit-daily-mix-conflict-cs-${info.project.name}.png`});
  await f.panel.getByRole('button',{name:t.reload,exact:true}).click();await expect(f.panel.getByRole('combobox',{name:t.news,exact:true})).toHaveValue('0');await expect(f.panel.getByRole('combobox',{name:t.education,exact:true})).toHaveValue('1');await expect(f.panel.getByRole('button',{name:t.reload,exact:true})).toHaveCount(0);expect(f.calls()).toBe(1);
  expect(errors.filter(error=>!error.includes('/api/marketing/dneskai/daily-mix')||!error.includes('409'))).toEqual([]);
 });
}
