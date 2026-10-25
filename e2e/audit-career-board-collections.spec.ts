import { test, expect, type Route } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { gotoPreview } from './helpers';
import { jobs } from '../src/lib/i18n/sections/jobs';
import { sessionOwner } from './owner-session-fixtures';
const stamp='2026-10-25T12:00:00Z';
const id=(i:number)=>`${i.toString(16).padStart(8,'0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`;
for(const lang of ['en','cs'] as const)test(`${lang}: complete board columns page independently and reveal only a confirmed move`,async({page},info)=>{
 const t=jobs[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let reads=0,moves=0,held:Route|undefined;
 let applications=Array.from({length:101},(_,i)=>({id:id(i),user_id:sessionOwner,listing_id:null,title:`Synthetic React role ${String(i).padStart(4,'0')}`,company:'Synthetic company',url:`https://thehub.io/jobs/applied-${i}`,source:'manual',location:'Oslo',cover_letter:'Synthetic letter',status:i<80?'applied':'interviewing',applied_on:i<80?'2026-10-01':'2026-10-25',notes:null,created_at:stamp,updated_at:stamp,organization_id:null,next_follow_up_at:null,cover_letter_url:null,request_id:null,responded_on:null,response_kind:null,contact_name:null,contact_email:null}));
 const saved=Array.from({length:101},(_,i)=>({id:id(2000+i),user_id:sessionOwner,listing_id:null,title:`Synthetic saved role ${String(i).padStart(4,'0')}`,company:'Synthetic company',url:`https://thehub.io/jobs/saved-${i}`,source:'manual',location:'Oslo',description:'Synthetic React role',cover_letter:'',notes:null,saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'draft'}));
 saved.push({...saved[0],id:id(3000),title:'Duplicate saved role',url:applications[0].url},{...saved[0],id:id(3001),title:'Archived Prague role',location:'Prague'});
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{const input=route.request().postDataJSON();if(input.p_entity!=='job_scrape_runs')reads++;return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='saved_job_positions'?saved:input.p_entity==='job_applications'?applications:[]}});});
 await page.route('**/rest/v1/rpc/update_job_application_progress',route=>{moves++;if(moves===1)return route.fulfill({status:503,json:{message:'PRIVATE TEST'}});held=route;});
 await page.goto('/dev-preview?tab=career&career=records');const main=page.getByRole('main');await main.getByRole('button',{name:new RegExp(`^${t.appliedTab}`)}).click();await main.getByRole('button',{name:t.boardView,exact:true}).click();
 const board=main.getByRole('region',{name:t.boardRegion,exact:true}),column=(name:string)=>board.locator(`[data-career-board-column="${name}"]`);
 await expect(column('saved').getByRole('link')).toHaveCount(10);await expect(column('applied').getByRole('link')).toHaveCount(10);await expect(column('interviewing').getByRole('link')).toHaveCount(10);await expect(column('saved').locator('h3')).toContainText('101');await expect(board.getByText('Duplicate saved role',{exact:true})).toHaveCount(0);await expect(board.getByText('Archived Prague role',{exact:true})).toHaveCount(0);
 const savedPager=column('saved').getByRole('navigation',{name:t.boardPages(t.savedTab),exact:true}),appliedPager=column('applied').getByRole('navigation',{name:t.boardPages(t.statusApplied),exact:true});await savedPager.getByRole('button',{name:t.nextPage,exact:true}).click();await expect(savedPager.getByRole('status')).toHaveText(t.pageRange(11,20,101));await expect(column('saved').getByRole('link').first()).toHaveText(saved[10].title);
 await appliedPager.getByRole('button',{name:t.nextPage,exact:true}).click();await expect(appliedPager.getByRole('status')).toHaveText(t.pageRange(11,20,80));await appliedPager.getByRole('button',{name:t.previousPage,exact:true}).click();expect(reads).toBe(6);expect(moves).toBe(0);
 const moving=applications[0],control=()=>column('applied').getByRole('combobox',{name:new RegExp(moving.title)});await control().click();await page.getByRole('option',{name:t.statusInterviewing,exact:true}).click();await expect.poll(()=>moves).toBe(1);await expect(control()).toBeEnabled();await expect(control()).toBeFocused();await expect(column('applied').getByRole('link',{name:moving.title,exact:true})).toBeVisible();
 await control().click();await page.getByRole('option',{name:t.statusInterviewing,exact:true}).click();await expect.poll(()=>moves).toBe(2);await expect(control()).toBeDisabled();
 applications=applications.map(app=>app.id===moving.id?{...app,status:'interviewing'}:app);await held!.fulfill({json:applications.find(app=>app.id===moving.id)});
 const landed=column('interviewing').getByRole('combobox',{name:new RegExp(moving.title)});await expect(landed).toBeVisible();await expect(landed).toBeFocused();await expect(column('interviewing').getByRole('navigation').getByRole('status')).toHaveText(t.pageRange(21,22,22));
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);const boxes=await board.locator('[data-career-board-column]').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().width));expect(Math.max(...boxes)-Math.min(...boxes)).toBeLessThan(1);if(width<768){expect((await landed.boundingBox())!.height).toBeGreaterThanOrEqual(44);const handle=column('interviewing').getByRole('button',{name:t.boardMoveCard(moving.title),exact:true});const box=await handle.boundingBox();expect(box!.height).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);}}
 const captureWidth=info.project.name==='mobile'?430:1440;
 await page.setViewportSize({width:captureWidth,height:4000});
 await board.evaluate(element=>{element.scrollLeft=0;});
 if(lang==='cs') {
  const file=`test-results/career-board-paging-cs-${captureWidth}.png`;
  await board.screenshot({path:file,animations:'disabled'});
  const frame=await board.boundingBox(),pager=await savedPager.boundingBox();
  const marks=[{x:100*(pager!.x-frame!.x)/frame!.width,y:100*(pager!.y-frame!.y)/frame!.height,w:100*pager!.width/frame!.width,h:100*pager!.height/frame!.height,n:1}];
  writeFileSync(`test-results/career-board-paging-cs-${captureWidth}.json`,JSON.stringify({file,width:captureWidth,box:frame,marks},null,2)+'\n');
 }
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
