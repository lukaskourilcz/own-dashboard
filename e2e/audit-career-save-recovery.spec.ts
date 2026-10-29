import {test,expect,type Route} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFileSync} from 'node:fs';
import {gotoPreview} from './helpers';
import {jobs} from '../src/lib/i18n/sections/jobs';
import {sessionOwner} from './owner-session-fixtures';
const stamp='2026-10-26T12:00:00Z',id='55555555-5555-4555-8555-555555555555';
for(const lang of ['en','cs'] as const)test(`${lang}: an uncertain Career save retains one stable retry and preserves an existing private draft`,async({page},info)=>{
 const t=jobs[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let writes=0,held:Route|undefined,requestId:string|undefined;
 const listing={id,source:'ashby-sanity',external_id:'new',title:'Synthetic public React role',company:'Synthetic company',url:'https://jobs.ashbyhq.com/sanity/capture-recovery',location:'Europe',role:'frontend',remote:true,salary:null,tags:['React'],seniority:null,description:'React TypeScript',posted_at:null,first_seen_at:stamp,last_seen_at:stamp};
 const saved:{id:string,user_id:string,listing_id:string,title:string,company:string,url:string,source:string,location:string,remote:boolean,description:string,cover_letter:string,notes:string,saved_at:string,updated_at:string,cover_letter_url:null,readiness:string}[]=[];
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{const input=route.request().postDataJSON();return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='saved_job_positions'?saved:input.p_entity==='job_listings'?[listing]:[]}});});
 await page.route('**/api/jobs/available',route=>route.fulfill({json:{ownerId:sessionOwner,candidateVersion:'c'.repeat(64),previouslyChecked:0,versions:{[id]:{source:listing.source,title:listing.title,url:listing.url,lastSeenAt:stamp}},states:{[id]:'open'},checkedAt:new Date().toISOString(),candidates:1,remaining:0}}));
 await page.route('**/rest/v1/rpc/capture_career_listing',route=>{writes++;const input=route.request().postDataJSON();expect(input.p_expected_owner).toBe(sessionOwner);expect(input.p_listing_id).toBe(id);expect(input.p_url).toBe(listing.url);expect(input.p_last_seen_at).toBe(stamp);if(requestId)expect(input.p_saved_id).toBe(requestId);else requestId=input.p_saved_id;held=route;});
 await page.goto('/dev-preview?tab=career&career=records');const main=page.getByRole('main');await main.getByRole('button',{name:t.openTab,exact:true}).click();const card=main.locator('[data-career-listing]');await expect(card).toHaveCount(1);
 await card.getByRole('button',{name:t.savePosition,exact:true}).evaluate(element=>{const button=element as HTMLButtonElement;button.focus();button.click();button.click();});await expect.poll(()=>writes).toBe(1);await expect(card.getByRole('button',{name:t.saving,exact:true})).toBeDisabled();
 await held!.fulfill({status:503,json:{message:'PRIVATE TEST'}});const notice=main.getByRole('alert');await expect(notice).toHaveText(t.saveUnconfirmed);await expect(card.getByRole('button',{name:t.savePosition,exact:true})).toBeEnabled();await expect(card.getByRole('button',{name:t.savePosition,exact:true})).toBeFocused();expect(await main.getByText('PRIVATE TEST').count()).toBe(0);
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);expect((await notice.locator('..').boundingBox())!.width).toBeLessThanOrEqual(768);}
 if(lang==='cs'){
  const width=info.project.name==='mobile'?430:1440;await page.setViewportSize({width,height:1000});
  const frame=notice.locator('..');await frame.screenshot({path:`test-results/career-save-recovery-cs-${width}.png`,animations:'disabled'});
  const box=await frame.boundingBox(),message=await notice.boundingBox(),button=await frame.getByRole('button').boundingBox();
  writeFileSync(`test-results/career-save-recovery-cs-${width}.json`,JSON.stringify({viewport:{width,height:1000},box,marks:[message,button].map((mark,index)=>({x:100*(mark!.x-box!.x)/box!.width,y:100*(mark!.y-box!.y)/box!.height,w:100*mark!.width/box!.width,h:100*mark!.height/box!.height,n:index+1}))},null,2)+'\n');
 }
 await notice.locator('..').getByRole('button',{name:lang==='cs'?'Zkusit znovu':'Try again',exact:true}).click();await expect.poll(()=>writes).toBe(2);await expect(card.getByRole('button',{name:t.saving,exact:true})).toBeDisabled();
 const row={id:'66666666-6666-4666-8666-666666666666',user_id:sessionOwner,listing_id:id,title:'Synthetic private owner title',company:listing.company,url:listing.url,source:listing.source,location:listing.location,remote:true,description:listing.description,cover_letter:'Synthetic private draft',notes:'Synthetic private note',saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'needs_review'};saved.push(row);await held!.fulfill({json:{ownerId:sessionOwner,requestId,created:false,row}});
 await expect(card.getByRole('button',{name:t.savedBadge,exact:true})).toBeDisabled();await expect(notice).toHaveCount(0);await expect(card.getByRole('button',{name:listing.title,exact:true})).toBeFocused();
 await main.getByRole('button',{name:new RegExp(`^${t.savedTab}`)}).first().click();await expect(main.getByText(row.title,{exact:true})).toBeVisible();await expect(main.locator('[data-career-position]')).toHaveCount(1);expect(writes).toBe(2);expect(errors).toEqual([]);
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
});

for(const lang of ['en','cs'] as const)test(`${lang}: changed offers require a fresh attempt and leaving cancels late save effects`,async({page})=>{
 const t=jobs[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let held:Route|undefined,writes=0,firstId:string|undefined,lastId:string|undefined;
 const listing={id,source:'ashby-sanity',external_id:'new',title:'Synthetic React role',company:'Synthetic company',url:'https://jobs.ashbyhq.com/sanity/capture-lifetime',location:'Europe',role:'frontend',remote:true,salary:null,tags:['React'],seniority:null,description:'React TypeScript',posted_at:null,first_seen_at:stamp,last_seen_at:stamp};
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{const input=route.request().postDataJSON();return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='job_listings'?[listing]:[]}});});
 await page.route('**/api/jobs/available',route=>route.fulfill({json:{ownerId:sessionOwner,candidateVersion:'d'.repeat(64),previouslyChecked:0,versions:{[id]:{source:listing.source,title:listing.title,url:listing.url,lastSeenAt:stamp}},states:{[id]:'open'},checkedAt:new Date().toISOString(),candidates:1,remaining:0}}));
 await page.route('**/rest/v1/rpc/capture_career_listing',route=>{writes++;const input=route.request().postDataJSON();lastId=input.p_saved_id;if(writes===1)firstId=lastId;if(writes===2)expect(lastId).toBe(firstId);if(writes===3)expect(lastId).not.toBe(firstId);held=route;});
 await page.goto('/dev-preview?tab=career&career=records');const main=page.getByRole('main');await main.getByRole('button',{name:t.openTab,exact:true}).click();const card=main.locator('[data-career-listing]');await expect(card).toHaveCount(1);
 await card.getByRole('button',{name:t.savePosition,exact:true}).click();await expect.poll(()=>writes).toBe(1);const search=main.getByRole('textbox',{name:t.searchPlaceholder,exact:true});await search.click();await search.pressSequentially('React');
 await held!.fulfill({status:503,json:{message:'PRIVATE TEST'}});await expect(main.getByRole('alert')).toHaveText(t.saveUnconfirmed);await expect(search).toBeFocused();
 await main.getByRole('alert').locator('..').getByRole('button',{name:lang==='cs'?'Zkusit znovu':'Try again',exact:true}).click();await expect.poll(()=>writes).toBe(2);await held!.fulfill({status:404,json:{code:'P0002',message:'PRIVATE TEST'}});
 await expect(main.getByRole('alert')).toHaveText(t.saveListingChanged);await expect(main.getByRole('alert').locator('..').getByRole('button',{name:t.checkOffers,exact:true})).toBeVisible();
 // A new explicit save has a new id after the definitely-refused source conflict.
 await card.getByRole('button',{name:t.savePosition,exact:true}).click();await expect.poll(()=>writes).toBe(3);await page.getByRole('navigation').first().getByRole('button',{name:lang==='cs'?'Domů':'Home',exact:true}).click();
 await expect(main.locator('[data-career-listing]')).toHaveCount(0);await expect.poll(()=>held!.request().failure()?.errorText??'').not.toBe('');
 await held!.fulfill({json:{ownerId:sessionOwner,requestId:lastId,created:true,row:{id:lastId,user_id:sessionOwner,listing_id:id,title:listing.title,company:listing.company,url:listing.url,source:listing.source,location:listing.location,remote:true,description:listing.description,cover_letter:'',notes:null,saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'draft'}}}).catch(()=>undefined);
 await expect(page.getByText(t.positionSaved,{exact:true})).toHaveCount(0);expect(writes).toBe(3);expect(errors).toEqual([]);
});
