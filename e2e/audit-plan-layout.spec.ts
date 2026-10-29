import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { plans as copy } from '../src/lib/i18n/sections/plans';
const owner='11111111-1111-4111-8111-111111111111',stamp='2026-10-25T17:00:00Z';
for(const lang of ['en','cs'] as const)test(`${lang}: Goals centers its compact content and aligns record text with matching controls`,async({page})=>{
 const t=copy[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 const rows=[{id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',title:'Launch side project',notes:'Ship the MVP first.'},{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',title:'Long goal '+ 'accessible-workspace-'.repeat(8),notes:'Retained complete long note'}].map(item=>({...item,user_id:owner,target_date:null,status:'active',recurrence:'none',last_completed_at:null,linked_calendar_event_id:null,created_at:stamp,updated_at:stamp}));
 await page.route('**/rest/v1/rpc/read_owned_collection',route=>route.fulfill({json:rows}));await page.goto('/dev-preview?tab=goals&planRecords=live');const board=page.getByRole('region',{name:t.statusBoard,exact:true});await board.getByText(rows[0].title,{exact:true}).waitFor();
 for(const width of [360,430,768,1024,1440,1728]){
  await page.setViewportSize({width,height:1000});const container=board.locator('..');await expect.poll(async()=>(await container.boundingBox())?.width??Infinity).toBeLessThanOrEqual(1025);
  await expect.poll(async()=>{const box=await container.boundingBox(),parent=await container.locator('..').boundingBox();return box&&parent?Math.abs((box.x+box.width/2)-(parent.x+parent.width/2)):Infinity;}).toBeLessThanOrEqual(1);
  const edit=board.getByRole('button',{name:`${rows[1].title}: ${t.changeStatus}`,exact:true}),title=board.getByText(rows[1].title,{exact:true});
  await expect.poll(async()=>{const a=await edit.boundingBox(),b=await title.boundingBox();return a&&b?Math.abs((a.y+a.height/2)-(b.y+b.height/2)):Infinity;}).toBeLessThanOrEqual(1);
  const buttons=[page.getByRole('button',{name:t.newPlan,exact:true}),page.getByRole('button',{name:t.board,exact:true}),page.getByRole('button',{name:t.timeline,exact:true})];const heights=await Promise.all(buttons.map(async button=>(await button.boundingBox())?.height??0));expect(Math.max(...heights)-Math.min(...heights)).toBeLessThanOrEqual(1);if(width<768)expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
 }
 await page.getByRole('button',{name:t.timeline,exact:true}).click();const timeline=page.getByRole('region',{name:t.timeline,exact:true});
 for(const width of [360,430,768,1024,1440,1728]){
  await page.setViewportSize({width,height:1000});const title=timeline.getByText(rows[0].title,{exact:true}).locator('..'),note=timeline.getByText(rows[0].notes,{exact:true});
  await expect(note).toBeVisible();
  if(width<768)await expect.poll(async()=>{const a=await title.boundingBox(),b=await note.boundingBox();return a&&b?b.y-a.y-a.height:-Infinity;}).toBeGreaterThanOrEqual(0);
  if(width>=768)await expect.poll(async()=>{const a=await title.boundingBox(),b=await note.boundingBox();return a&&b?Math.abs((a.y+a.height/2)-(b.y+b.height/2)):Infinity;}).toBeLessThanOrEqual(1);
  const status=timeline.getByRole('combobox',{name:`${rows[0].title}: ${t.status}`,exact:true}),remove=timeline.getByRole('button',{name:`${rows[0].title}: ${t.deletePlan}`,exact:true});await expect.poll(async()=>Math.abs(((await status.boundingBox())?.height??0)-((await remove.boundingBox())?.height??0))).toBeLessThanOrEqual(1);await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
 }
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
for (const lang of ['en', 'cs'] as const) test(`${lang}: Goals returns keyboard focus after every pristine editor dismissal`, async ({ page }) => {
 const t = copy[lang], errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
 await page.goto('/dev-preview?tab=goals');
 const opener = page.getByRole('button', { name: t.newPlan, exact: true, includeHidden: true });
 for (const dismissal of ['escape', 'close', 'outside']) {
  await opener.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: t.newPlan, exact: true });
  await expect(dialog.getByLabel(t.formTitle, { exact: true })).toBeFocused();
  await expect(opener).toHaveAttribute('aria-expanded', 'true');
  if (dismissal === 'escape') await page.keyboard.press('Escape');
  else if (dismissal === 'close') await dialog.getByRole('button', { name: lang === 'cs' ? 'Zavřít' : 'Close', exact: true }).click();
  else await page.mouse.click(4, 4);
  await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused(); await expect(opener).toHaveAttribute('aria-expanded', 'false');
 }
 expect(errors).toEqual([]);
});
