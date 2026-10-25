import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, signInFixtureUser } from './helpers';
import { plans as copy } from '../src/lib/i18n/sections/plans';
import { guest } from '../src/lib/i18n/sections/guest';
import { common } from '../src/lib/i18n/sections/common';
import type { Plan } from '../src/lib/types';
const owner='11111111-1111-4111-8111-111111111111',stamp='2026-10-25T17:00:00Z';
const first='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',second='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const row=(id=first,title='Synthetic owned plan'):Plan=>({id,user_id:owner,title,target_date:'2026-11-01',status:'active',recurrence:'weekly',notes:'Retained synthetic plan note',last_completed_at:null,linked_calendar_event_id:'retained-event',created_at:stamp,updated_at:stamp});
async function scan(page:import('@playwright/test').Page,selector='main') { expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include(selector).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]); }
for(const lang of ['en','cs'] as const){
 test(`${lang}: uncertain plan creation retains one id, locks the form and keeps the confirmed plan after Calendar failure`,async({page})=>{
  const t=copy[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});await signInFixtureUser(page,owner);
  let saved:Plan|null=null,posts=0,recoveries=0,events=0,release!:()=>void;const ids:string[]=[];
  await page.route('**/rest/v1/rpc/read_owned_collection',route=>{expect(route.request().postDataJSON()).toEqual({p_entity:'plans',p_expected_owner:owner});return route.fulfill({json:saved?[saved]:[]});});
  await page.route('**/rest/v1/plans?*',async route=>{
   const method=route.request().method();if(method==='GET'){recoveries++;return route.fulfill({json:saved?[saved]:[]});}
   expect(method).toBe('POST');const input=route.request().postDataJSON();ids.push(input.id);expect(input.user_id).toBe(owner);posts++;
   if(posts===1){saved={...input,created_at:stamp,updated_at:stamp};await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({status:503,json:{message:'Synthetic lost receipt'}});}
   return route.fulfill({status:409,json:{code:'23505',message:'Synthetic duplicate'}});
  });
  await page.route('**/api/calendar/event',route=>{events++;expect(route.request().headers()['x-calendar-owner']).toBe(owner);return route.fulfill({status:503,json:{reason:'unconfirmed'}});});
  await page.goto('/dev-preview?tab=goals&planRecords=live');await page.getByRole('button',{name:t.newPlan,exact:true}).click();const dialog=page.getByRole('dialog',{name:t.newPlan,exact:true}),title=dialog.getByLabel(t.formTitle,{exact:true});
  await title.fill('Synthetic retained plan');await dialog.getByLabel(t.targetDate,{exact:true}).fill('2026-11-01');await dialog.getByRole('checkbox').check();await dialog.getByRole('button',{name:t.addPlan,exact:true}).click();
  await expect(title).toBeDisabled();for(const combo of await dialog.getByRole('combobox').all())await expect(combo).toBeDisabled();await page.keyboard.press('Escape');await expect(dialog).toBeVisible();await expect.poll(()=>typeof release).toBe('function');release();
  await expect(dialog.getByRole('alert')).toHaveText(t.saveUnconfirmed);await expect(title).toHaveValue('Synthetic retained plan');await expect(title).toBeEnabled();expect(events).toBe(0);
  for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
  await scan(page,'[role="dialog"]');await dialog.getByRole('button',{name:t.addPlan,exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('status')).toHaveText(t.calendarEventFailed);await expect(page.getByText('Synthetic retained plan',{exact:true})).toBeVisible();expect(posts).toBe(2);expect(recoveries).toBe(1);expect(new Set(ids).size).toBe(1);expect(events).toBe(1);expect(errors).toEqual([]);
 });
 test(`${lang}: stale plan changes retain rows, confirmed changes preserve fields and Calendar cleanup failure keeps deletion`,async({page})=>{
  const t=copy[lang],c=common[lang];await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});await signInFixtureUser(page,owner);
  let rows=[row(first,'Synthetic long goal '+ 'without-spaces-'.repeat(9)),row(second,'Synthetic next plan')],patches=0,deletions=0,calendar=0,release!:()=>void;
  await page.route('**/rest/v1/rpc/read_owned_collection',route=>route.fulfill({json:rows}));
  await page.route('**/rest/v1/plans?*',async route=>{
   const request=route.request(),query=new URL(request.url()).searchParams;expect(query.get('user_id')).toBe(`eq.${owner}`);expect(query.get('id')).toBe(`eq.${first}`);expect(query.get('select')).not.toContain('*');
   if(request.method()==='PATCH'){
    patches++;if(patches===1){rows=rows.map(item=>item.id===first?{...item,notes:'Newer retained note',updated_at:'2026-10-25T17:00:00.000001Z'}:item);return route.fulfill({json:[]});}
    expect(query.get('updated_at')).toBe(`eq.${rows[0].updated_at}`);rows=rows.map(item=>item.id===first?{...item,...request.postDataJSON(),updated_at:'2026-10-25T17:00:00.000002Z'}:item);await new Promise<void>(resolve=>{release=resolve;});return route.fulfill({json:[rows[0]]});
   }
   expect(request.method()).toBe('DELETE');deletions++;if(deletions===1){rows=rows.map(item=>item.id===first?{...item,updated_at:'2026-10-25T17:00:00.000003Z'}:item);return route.fulfill({json:[]});}const removed=rows[0];rows=rows.slice(1);return route.fulfill({json:[removed]});
  });
  await page.route('**/api/calendar/event',route=>{calendar++;expect(route.request().method()).toBe('DELETE');expect(route.request().headers()['x-calendar-owner']).toBe(owner);return route.fulfill({status:503,json:{}});});
  await page.goto('/dev-preview?tab=goals&planRecords=live');const name=rows[0].title;
  await page.getByRole('button',{name:`${name}: ${t.changeStatus}`,exact:true}).click();await page.getByRole('button',{name:t.statusLabel.done,exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toContainText(t.planChanged);expect(calendar).toBe(0);
  await page.getByRole('button',{name:c.retry,exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);await page.getByRole('button',{name:t.timeline,exact:true}).click();await expect(page.getByText('Newer retained note',{exact:true})).toBeVisible();
  const status=page.getByRole('combobox',{name:`${name}: ${t.status}`,exact:true});await status.click();await page.getByRole('option',{name:t.statusLabel.done,exact:true}).click();await expect(status).toBeDisabled();await expect(page.getByRole('combobox',{name:`Synthetic next plan: ${t.status}`,exact:true})).toBeEnabled();await expect.poll(()=>typeof release).toBe('function');release();await expect(status).toContainText(t.statusLabel.done);await expect(status).toBeEnabled();
  for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);if(width<768)await expect.poll(async()=>(await status.boundingBox())?.height??0).toBeGreaterThanOrEqual(44);}
  await scan(page);const remove=()=>page.getByRole('button',{name:`${name}: ${t.deletePlan}`,exact:true}).click();const confirm=()=>page.getByRole('dialog',{name:c.delete,exact:true}).getByRole('button',{name:c.delete,exact:true}).click();
  await remove();await confirm();await expect(page.getByRole('main').getByRole('alert')).toContainText(t.planChanged);expect(calendar).toBe(0);await page.getByRole('button',{name:c.retry,exact:true}).click();await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);await remove();await confirm();await expect(page.getByText(name,{exact:true})).toHaveCount(0);await expect(page.getByRole('status')).toHaveText(t.calendarDeleteFailed);expect(deletions).toBe(2);expect(calendar).toBe(1);await expect(page.getByRole('button',{name:`Synthetic next plan: ${t.deletePlan}`,exact:true})).toBeFocused();
 });
 test(`${lang}: Home recurring completion confirms one captured row and retains it after a failed attempt`,async({page})=>{
  const t=copy[lang];await page.clock.setFixedTime(new Date('2026-10-25T17:00:00Z'));await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});await signInFixtureUser(page,owner);let value=row(),patches=0;
  await page.route('**/rest/v1/rpc/read_owned_collection',route=>route.fulfill({json:[value]}));await page.route('**/rest/v1/plans?*',route=>{patches++;if(patches===1)return route.fulfill({status:503,json:{message:'Synthetic write failure'}});value={...value,...route.request().postDataJSON(),updated_at:'2026-10-25T17:00:00.000001Z'};return route.fulfill({json:[value]});});
  await page.goto('/dev-preview?tab=home&planRecords=live');const region=page.getByRole('region',{name:t.recurringTitle,exact:true});const mark=region.getByRole('button',{name:`${value.title}: ${t.markDone}`,exact:true});await mark.click();await expect(region.getByRole('alert')).toContainText(t.actionUnconfirmed);await expect(mark).toHaveAttribute('aria-pressed','false');await expect(mark).toBeEnabled();expect(patches).toBe(1);await mark.click();await expect(region.getByRole('button',{name:`${value.title}: ${t.markNotDone}`,exact:true})).toHaveAttribute('aria-pressed','true');expect(patches).toBe(2);
  if(test.info().project.name==='mobile')await expect.poll(async()=>(await region.getByRole('button',{name:`${value.title}: ${t.markNotDone}`,exact:true}).boundingBox())?.height??0).toBeGreaterThanOrEqual(44);await scan(page,`[role="region"][aria-label="${t.recurringTitle}"]`);
 });
}

for(const lang of ['en','cs'] as const)test(`${lang}: guest plan submission retains its draft and sends no private request`,async({page})=>{
 const t=copy[lang],requests:string[]=[];
 await page.route('**/api/**',route=>{requests.push('api');return route.fulfill({json:{}});});await page.route(/example\.supabase\.co/,route=>{requests.push('database');return route.fulfill({json:[]});});
 await page.goto(`/guest?lang=${lang}`);await page.keyboard.press('Control+k');await page.getByRole('dialog').getByRole('button',{name:t.title,exact:true}).click();await page.getByRole('button',{name:t.newPlan,exact:true}).click();const dialog=page.getByRole('dialog',{name:t.newPlan,exact:true}),title=dialog.getByLabel(t.formTitle,{exact:true});await title.fill('Synthetic guest plan');await dialog.getByRole('button',{name:t.addPlan,exact:true}).click();await expect(page.getByRole('status').filter({hasText:guest[lang].readOnlyAction})).toBeVisible();await expect(title).toHaveValue('Synthetic guest plan');await expect(dialog.getByRole('alert')).toHaveCount(0);expect(requests).toEqual([]);
});
