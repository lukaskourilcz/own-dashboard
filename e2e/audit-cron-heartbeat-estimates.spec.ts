import {expect,test} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {gotoPreview,watchConsole} from './helpers';
import {projects} from '../src/lib/i18n/sections/projects';
import type {Cron,Project} from '../src/lib/types';
const owner='11111111-1111-4111-8111-111111111111',id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',stamp='2026-10-23T07:00:00Z';
for(const lang of ['en','cs'] as const){
 test(`${lang}: conservative cron estimates and unavailable time remain readable by keyboard`,async({page})=>{
  const errors=watchConsole(page);await page.clock.setFixedTime(new Date('2026-10-25T18:00:00Z'));await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
  const project:Project={id,user_id:owner,name:'Synthetic heartbeat project',slug:'synthetic-heartbeat',notes:'',repo_full_name:null,repo_id:null,previous_repo_full_names:[],previous_slugs:[],sort_order:0,is_active:true,engagement:'own',organization_id:null,parent_id:null,url:null,dev_url:null,color:null,created_at:stamp,updated_at:stamp};
  const cron=(number:number,name:string,schedule:string,last_success_at:string):Cron=>({id:`bbbbbbbb-bbbb-4bbb-8bbb-${String(number).padStart(12,'0')}`,user_id:owner,project_id:id,name,schedule,last_success_at,description:'',endpoint:'',heartbeat_url:'',is_ai_call:false,cost_per_run:0,currency:'USD',runs_per_month:30,enabled:true,last_run_at:null,created_at:stamp,updated_at:stamp});
  const rows=[cron(1,'Synthetic weekday','0 7 * * 1-5',stamp),cron(2,'Synthetic month end','0 7 31 * *','2026-08-31T07:00:00Z'),cron(3,'Synthetic future time','0 7 * * *','2026-10-26T07:00:00Z')];let writes=0;
  await page.route('**/rest/v1/rpc/read_owned_collection',route=>{const entity=route.request().postDataJSON().p_entity;return route.fulfill({json:entity==='projects'?[project]:entity==='crons'?rows:[]});});
  await page.route('**/rest/v1/crons**',route=>{if(route.request().method()!=='GET')writes++;return route.fulfill({json:rows});});
  await page.goto('/dev-preview?tab=projects&projectRecords=live');await page.locator('#main-content').getByRole('button',{name:projects[lang].manage,exact:true}).click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
  const weekday=dialog.getByRole('listitem').filter({hasText:'Synthetic weekday'}),monthly=dialog.getByRole('listitem').filter({hasText:'Synthetic month end'}),future=dialog.getByRole('listitem').filter({hasText:'Synthetic future time'});
  const weekdayPill=weekday.getByText(projects[lang].heartbeatOk,{exact:true});await expect(weekdayPill).toBeVisible();await expect(monthly.getByText(projects[lang].heartbeatOk,{exact:true})).toBeVisible();const futurePill=future.getByText(projects[lang].heartbeatUnknown,{exact:true});await expect(futurePill).toBeVisible();
  await page.mouse.move(4,4);await weekdayPill.scrollIntoViewIfNeeded();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));await weekdayPill.focus();await expect(weekdayPill).toBeFocused();await expect(page.getByRole('tooltip').filter({hasText:projects[lang].heartbeatEstimate})).toBeVisible();await page.keyboard.press('Escape');await futurePill.focus();await expect(page.getByRole('tooltip',{name:projects[lang].heartbeatUnknownHint,exact:true})).toBeVisible();await page.keyboard.press('Escape');
  for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1100});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);await expect(futurePill).toBeVisible();}
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(writes).toBe(0);expect(errors).toEqual([]);
 });
}
