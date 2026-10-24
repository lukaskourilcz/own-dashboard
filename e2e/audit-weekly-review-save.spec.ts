import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {gotoPreview,watchConsole} from './helpers';
import {professional} from '../src/lib/i18n/sections/professional';
import {common} from '../src/lib/i18n/sections/common';
import {nav} from '../src/lib/i18n/sections/nav';
import {mondayKey,previousMondayKey} from '../src/lib/date-keys';
import type {WeeklyReview} from '../src/lib/types';
const owner='11111111-1111-4111-8111-111111111111',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function fixture(page:Page,lang:'en'|'cs'){
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 let row:WeeklyReview={id,user_id:owner,week_start:mondayKey(),summary:'Retained fixture summary',status:'draft',items:{step:'summary',facts:['Retained fixture fact'],futureKey:{retained:true}},completed_at:null,created_at:'2026-10-19T09:00:00Z',updated_at:'2026-10-24T09:00:00.123456Z'};
 let calls=0,direct=0,reads=0,fail=false,hold=false,conflict=false,release:(()=>void)|undefined;
 const inputs:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/weekly_reviews?**',route=>{if(route.request().method()!=='GET'){direct++;return route.fulfill({status:405,json:{}});}reads++;return route.fulfill({json:[row]});});
 await page.route('**/rest/v1/rpc/weekly_focus_snapshot',route=>route.fulfill({json:{ownerId:owner,weekStart:previousMondayKey(),sets:[]}}));
 await page.route('**/rest/v1/rpc/save_weekly_review',async route=>{
  calls++;const input=route.request().postDataJSON();inputs.push(input);expect(input.p_owner).toBe(owner);expect(input.p_id).toBe(id);expect(input.p_week_start).toBe(mondayKey());
  expect(input.p_patch.items.facts).toBeUndefined();expect(input.p_patch.items.futureKey).toBeUndefined();
  if(hold)await new Promise<void>(resolve=>{release=resolve;});release=undefined;
  if(fail)return route.fulfill({status:503,json:{message:'Private fixture save refusal'}});
  const before=row.updated_at;
  if(conflict)return route.fulfill({json:{kind:'conflict',ownerId:owner,weekStart:row.week_start,sourceUpdatedAt:before,review:null}});
  row={...row,summary:input.p_patch.summary??row.summary,items:{...row.items,...input.p_patch.items},updated_at:new Date().toISOString(),...(input.p_mode==='draft'?{status:'draft' as const,completed_at:null}:{})};
  return route.fulfill({json:{kind:'saved',ownerId:owner,weekStart:row.week_start,sourceUpdatedAt:before,review:row}});
 });
 await page.goto('/dev-preview?tab=work&planning=live');const card=page.getByTestId('weekly-planning');await expect(card.getByRole('textbox').first()).toHaveValue(row.summary);
 return{card,state:()=>({calls,direct,reads,inputs}),fail:(value:boolean)=>{fail=value;},hold:(value:boolean)=>{hold=value;},conflict:()=>{conflict=true;row={...row,summary:'New saved fixture summary',updated_at:'2026-10-25T09:00:00.123457Z'};},release:async()=>{await expect.poll(()=>typeof release).toBe('function');release!();}};
}
for(const lang of ['en','cs'] as const){
 test(`${lang}: weekly draft survives a held failed save and retries with one captured request`,async({page})=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=professional[lang];await f.card.getByRole('textbox').first().fill('Retain the changed fixture draft');f.fail(true);f.hold(true);
  await f.card.getByRole('button',{name:t.saveDraft,exact:true}).click();await expect.poll(()=>f.state().calls).toBe(1);await expect(f.card.getByRole('textbox').first()).toBeDisabled();
  await f.card.getByRole('button',{name:t.completeWeek,exact:true}).dispatchEvent('click');expect(f.state().calls).toBe(1);
  await page.getByRole('button',{name:nav[lang].sections.home,exact:true}).click();const guard=page.getByRole('dialog');await expect(guard.getByRole('heading')).toHaveText(common[lang].unsaved.pendingTitle);await expect(guard.getByRole('button',{name:common[lang].unsaved.discard,exact:true})).toBeDisabled();
  await f.release();await expect(guard.getByRole('heading')).toHaveText(common[lang].unsaved.title);await guard.getByRole('button',{name:common[lang].unsaved.stay,exact:true}).click();await expect(f.card.getByRole('alert')).toContainText(t.planningSaveFailed);await expect(f.card.getByRole('textbox').first()).toHaveValue('Retain the changed fixture draft');await expect(f.card.getByRole('textbox').first()).toBeEnabled();
  f.fail(false);f.hold(false);const before=f.state().reads;await f.card.getByRole('button',{name:t.saveDraft,exact:true}).click();await expect(f.card.getByRole('alert')).toHaveCount(0);await expect(f.card.getByRole('button',{name:t.saveDraft,exact:true})).toBeEnabled();
  expect(f.state().calls).toBe(2);expect(f.state().inputs[1]).toEqual(f.state().inputs[0]);expect(f.state().reads).toBe(before);expect(f.state().direct).toBe(0);
  expect(errors.filter(error=>!(error.includes('503')&&error.includes('/rpc/save_weekly_review')))).toEqual([]);
 });
 test(`${lang}: changed weekly review retains selectable text until explicit reload and reflows without duplicate step title`,async({page},info)=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=professional[lang];await f.card.getByRole('textbox').first().fill('My retained review draft');f.conflict();await f.card.getByRole('button',{name:t.saveDraft,exact:true}).click();
  await expect(f.card.getByRole('alert')).toContainText(t.planningConflict);await expect(f.card.getByRole('textbox').first()).toHaveValue('My retained review draft');await expect(f.card.getByRole('textbox').first()).toBeEnabled();expect(await f.card.getByRole('textbox').first().evaluate(element=>(element as HTMLTextAreaElement).readOnly)).toBe(true);await expect(f.card.getByRole('button',{name:t.saveDraft,exact:true})).toBeDisabled();
  const retained=f.card.getByRole('textbox').first();await retained.focus();await retained.press('ControlOrMeta+A');expect(await retained.evaluate(element=>{const field=element as HTMLTextAreaElement;return field.selectionEnd-field.selectionStart;})).toBe('My retained review draft'.length);
  await expect(f.card.getByRole('heading',{name:t.planningStepSummary,exact:true})).toHaveCount(1);
  for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(async()=>{const box=(await f.card.boundingBox())!;return box.x>=0&&box.x+box.width<=width+1;}).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
   await expect.poll(async()=>{const a=(await f.card.getByRole('button',{name:t.saveDraft,exact:true}).boundingBox())!,b=(await f.card.getByRole('button',{name:t.completeWeek,exact:true}).boundingBox())!;return Math.abs(a.width-b.width)<=1&&Math.abs(a.height-b.height)<=1&&Math.abs(a.y-b.y)<=1&&a.height>=(width<768?44:32);}).toBe(true);
  }
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="weekly-planning"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  await page.setViewportSize({width:info.project.name==='mobile'?360:1440,height:1000});if(lang==='cs')await f.card.screenshot({path:`/tmp/app-audit-weekly-review-conflict-cs-${info.project.name}.png`});
  await f.card.getByRole('button',{name:t.planningReload,exact:true}).click();await expect(f.card.getByRole('textbox').first()).toHaveValue('New saved fixture summary');await expect(f.card.getByRole('alert')).toHaveCount(0);expect(f.state().calls).toBe(1);expect(f.state().direct).toBe(0);expect(errors).toEqual([]);
 });
}
