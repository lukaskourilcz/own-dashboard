import {test,expect,type Page} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {gotoPreview,watchConsole} from './helpers';
import {todos} from '../src/lib/i18n/sections/todos';
import {common} from '../src/lib/i18n/sections/common';
import {nav} from '../src/lib/i18n/sections/nav';
const owner='11111111-1111-4111-8111-111111111111';
async function fixture(page:Page,lang:'en'|'cs'){
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 let rows:unknown[]=[];let reads=0;
 await page.route('**/rest/v1/rpc/read_owned_collection',route=>{expect(route.request().postDataJSON().p_entity).toBe('todos');reads++;return route.fulfill({json:rows});});
 let calls=0,fail=false,hold=false,conflict=false;let release:(()=>void)|undefined;
 const requests:Record<string,unknown>[]=[];
 await page.route('**/rest/v1/rpc/write_task',async route=>{
  calls++;const input=route.request().postDataJSON();requests.push(input);expect(input.p_owner).toBe(owner);expect(input.p_action).toBe('create');expect(input.p_expected).toBeNull();
  if(hold)await new Promise<void>(resolve=>{release=resolve;});release=undefined;
  if(fail)return route.fulfill({status:503,json:{message:'TEST_ONLY_PRIVATE'}});
  if(conflict)return route.fulfill({json:{kind:'conflict',ownerId:owner,id:input.p_id,task:null}});
  const task={id:input.p_id,user_id:owner,done:false,created_at:'2026-10-25T00:00:00.123456Z',updated_at:'2026-10-25T00:00:00.123456Z',category:null,source:null,repo_id:null,repo_full_name:null,repo_owner:null,repo_name:null,repo_url:null,needed_raw:null,needed_assignee:null,generated_at:null,opportunity_id:null,job_application_id:null,...input.p_values};rows=[task];
  return route.fulfill({json:{kind:'saved',ownerId:owner,id:input.p_id,task}});
 });
 await page.goto('/dev-preview?tasks=live');
 await page.getByRole('button',{name:nav[lang].sections.tasks,exact:true}).click();
 await page.getByRole('button',{name:todos[lang].addTask,exact:true}).click();
 const dialog=page.getByRole('dialog',{name:todos[lang].addTaskTitle,exact:true});await expect(dialog).toBeVisible();
 return{dialog,requests,reads:()=>reads,calls:()=>calls,fail:(value:boolean)=>{fail=value;},hold:(value:boolean)=>{hold=value;},conflict:()=>{conflict=true;},release:async()=>{await expect.poll(()=>typeof release).toBe('function');release!();}};
}
for(const lang of ['en','cs'] as const){
 test(`${lang}: failed task creation keeps its draft and retry identity while pending dismissal is blocked`,async({page})=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=todos[lang];const title=f.dialog.getByRole('textbox',{name:t.taskLabel,exact:true});
  await title.fill('TEST_ONLY retained task draft');f.fail(true);f.hold(true);await f.dialog.getByRole('button',{name:t.addTask,exact:true}).click();await expect.poll(f.calls).toBe(1);
  await expect(title).toBeDisabled();await expect(f.dialog.getByRole('button',{name:common[lang].cancel,exact:true})).toBeDisabled();await page.keyboard.press('Escape');await expect(f.dialog).toBeVisible();
  await f.dialog.getByRole('button',{name:t.addTask,exact:true}).dispatchEvent('click');expect(f.calls()).toBe(1);await f.release();await expect(f.dialog.getByRole('alert')).toContainText(t.createErr);await expect(title).toHaveValue('TEST_ONLY retained task draft');
  await expect.poll(f.reads).toBe(2);f.hold(false);f.fail(false);const before=f.reads();await f.dialog.getByRole('button',{name:t.addTask,exact:true}).click();await expect(f.dialog).toBeHidden();expect(f.calls()).toBe(2);expect(f.requests[1]).toEqual(f.requests[0]);expect(f.reads()).toBe(before);
  await expect(page.getByText('TEST_ONLY retained task draft',{exact:true})).toBeVisible();expect(errors.filter(error=>!/^Failed to load resource: the server responded with a status of 503 .*\(https:\/\/example\.supabase\.co\/rest\/v1\/rpc\/write_task\)$/.test(error))).toEqual([]);
 });
 test(`${lang}: conflicting task input stays selectable and the real form fits every supported width`,async({page},info)=>{
  const errors=watchConsole(page),f=await fixture(page,lang),t=todos[lang];const title=f.dialog.getByRole('textbox',{name:t.taskLabel,exact:true});
  await title.fill('TEST_ONLY copyable conflict');f.conflict();await f.dialog.getByRole('button',{name:t.addTask,exact:true}).click();await expect(f.dialog.getByRole('alert')).toContainText(t.createConflict);await expect(title).not.toBeDisabled();await expect(title).toHaveAttribute('readonly','');
  await title.focus();await page.keyboard.press('ControlOrMeta+A');expect(await title.evaluate(element=>(element as HTMLInputElement).selectionEnd!-(element as HTMLInputElement).selectionStart!)).toBe('TEST_ONLY copyable conflict'.length);
  for(const width of [360,390,768,1024,1440,1728]){
   await page.setViewportSize({width,height:1000});
   expect(await f.dialog.evaluate(element=>{const r=element.getBoundingClientRect();return r.left>=-1&&r.right<=innerWidth+1;})).toBe(true);
   const actions=f.dialog.locator('form > div').last().getByRole('button');const a=await actions.nth(0).boundingBox(),b=await actions.nth(1).boundingBox();expect(a).not.toBeNull();expect(b).not.toBeNull();expect(Math.abs(a!.width-b!.width)).toBeLessThanOrEqual(1);expect(a!.height).toBe(b!.height);expect(a!.height).toBeGreaterThanOrEqual(width<768?44:32);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  if(lang==='cs'){await page.setViewportSize({width:info.project.name==='mobile'?360:1440,height:1000});await f.dialog.screenshot({path:info.outputPath('task-create-conflict-cs.png')});}
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
 });
}
