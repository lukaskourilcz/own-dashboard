import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { jobs } from '../src/lib/i18n/sections/jobs';
import { sessionOwner } from './owner-session-fixtures';

const stamp = '2026-10-25T12:00:00Z';
const rows = Array.from({ length: 1201 }, (_, index) => ({
 id: `${index.toString(16).padStart(8,'0')}-bbbb-4bbb-8bbb-bbbbbbbbbbbb`,
 source:'remotive', external_id:String(index), title:`React frontend engineer ${String(index).padStart(4,'0')}`,
 company:'Synthetic company', url:`https://remotive.com/remote-jobs/synthetic/${index}`, location:'Europe', role:'frontend',
 remote:true, salary:null, tags:['React','TypeScript'], seniority:null, description:'React TypeScript frontend',
 posted_at:null, first_seen_at:stamp, last_seen_at:stamp,
}));

for (const lang of ['en','cs'] as const) test(`${lang}: complete Career collections stay lazy, searchable and locally paged`, async ({ page }) => {
 const t=jobs[lang], errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let reads=0,refreshes=0;
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{
  const input=route.request().postDataJSON();expect(input.p_expected_owner).toBe(sessionOwner);
  if(input.p_entity!=='job_scrape_runs') reads++;
  return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='job_listings'?rows:[]}});
 });
 await page.route('**/api/jobs/refresh',route=>{refreshes++;expect(route.request().headers()['x-own-dashboard-owner']).toBe(sessionOwner);const now=new Date().toISOString();return route.fulfill({json:{ownerId:sessionOwner,startedAt:now,finishedAt:now,ok:true,inserted:0,refreshed:0,pruned:0,sources:{curated:{count:0}}}});});
 await page.route('**/api/jobs/available',route=>route.fulfill({json:{states:Object.fromEntries(rows.map(row=>[row.id,'open'])),checkedAt:new Date().toISOString(),candidates:rows.length,remaining:0}}));
 await page.goto('/dev-preview?tab=career&career=records');
 await expect(page.getByTestId('oslo-job-grid')).toBeVisible();expect(reads).toBe(0);expect(refreshes).toBe(0);
 await page.getByRole('button',{name:t.checkOffers,exact:true}).first().click();
 await expect.poll(()=>reads).toBe(6);expect(refreshes).toBe(1);
 await page.getByRole('button',{name:t.openTab,exact:true}).click();
 const main=page.getByRole('main');
 await expect(main.locator('article')).toHaveCount(50);
 const pager=main.getByRole('navigation',{name:lang==='cs'?'Stránky nabídek':'Listing pages',exact:true});
 await expect(pager.getByRole('status')).toHaveText(lang==='cs'?'1–50 z 1201':'1–50 of 1201');
 await pager.getByRole('button',{name:lang==='cs'?'Další':'Next',exact:true}).click();
 await expect(pager.getByRole('status')).toHaveText(lang==='cs'?'51–100 z 1201':'51–100 of 1201');
 await expect(main.getByRole('button',{name:rows[50].title,exact:true})).toBeVisible();
 const search=main.getByRole('textbox',{name:t.searchPlaceholder,exact:true});await search.fill('1200');
 await expect(main.locator('article')).toHaveCount(1);await expect(main.getByRole('button',{name:rows[1200].title,exact:true})).toBeVisible();await expect(pager).toHaveCount(0);
 await search.fill('');await expect(main.locator('article')).toHaveCount(50);await expect(pager.getByRole('status')).toHaveText(lang==='cs'?'1–50 z 1201':'1–50 of 1201');await expect(search).toBeFocused();expect(reads).toBe(6);expect(refreshes).toBe(1);
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});

for (const lang of ['en','cs'] as const) test(`${lang}: saved positions and application history page complete local collections without refreshing providers`, async ({ page }) => {
 const t=jobs[lang],errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));let reads=0,refreshes=0;
 const saved=rows.map(row=>({id:row.id,user_id:sessionOwner,listing_id:null,title:row.title,company:row.company,url:row.url,source:row.source,location:'Oslo',description:row.description,cover_letter:'',notes:null,saved_at:stamp,updated_at:stamp,cover_letter_url:null,readiness:'draft'}));
 const applications=rows.map(row=>({id:row.id,user_id:sessionOwner,listing_id:null,title:row.title,company:row.company,url:row.url,source:row.source,location:'Oslo',cover_letter:'Synthetic letter',status:'applied',applied_on:'2026-10-25',notes:null,created_at:stamp,updated_at:stamp,organization_id:null,next_follow_up_at:null,cover_letter_url:null,request_id:null,responded_on:null,response_kind:null,contact_name:null,contact_email:null}));
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/rest/v1/rpc/read_career_records',route=>{
  const input=route.request().postDataJSON();expect(input.p_expected_owner).toBe(sessionOwner);if(input.p_entity!=='job_scrape_runs') reads++;
  return route.fulfill({json:{ownerId:sessionOwner,collection:input.p_entity,rows:input.p_entity==='saved_job_positions'?saved:input.p_entity==='job_applications'?applications:[]}});
 });
 await page.route('**/api/jobs/refresh',route=>{refreshes++;return route.fulfill({status:500});});
 await page.goto('/dev-preview?tab=career&career=records');await expect(page.getByTestId('oslo-job-grid')).toBeVisible();expect(reads).toBe(0);
 const main=page.getByRole('main');await main.getByRole('button',{name:new RegExp(`^${t.savedTab}`)}).click();
 const savedPager=main.getByRole('navigation',{name:t.savedPages,exact:true});await expect(main.locator('[data-career-position]')).toHaveCount(50);await expect(savedPager.getByRole('status')).toHaveText(t.pageRange(1,50,1201));
 await savedPager.getByRole('button',{name:t.nextPage,exact:true}).click();await expect(main.locator('[data-career-position]').first()).toHaveAttribute('data-career-position',rows[50].id);
 const savedSearch=main.getByRole('textbox',{name:lang==='cs'?'Hledat přihlášku':'Search applications',exact:true});await savedSearch.fill('1200');await expect(main.locator('[data-career-position]')).toHaveCount(1);await expect(main.locator('[data-career-position]')).toHaveAttribute('data-career-position',rows[1200].id);
 await savedSearch.fill('');await expect(savedPager.getByRole('status')).toHaveText(t.pageRange(1,50,1201));
 await main.getByRole('button',{name:new RegExp(`^${t.appliedTab}`)}).click();const appPager=main.getByRole('navigation',{name:t.applicationPages,exact:true});await expect(main.locator('[data-career-application]')).toHaveCount(50);await expect(appPager.getByRole('status')).toHaveText(t.pageRange(1,50,1201));
 await expect(main.getByText(t.statsTotal,{exact:true}).locator('..').getByText('1201',{exact:true})).toBeVisible();
 await appPager.getByRole('button',{name:t.nextPage,exact:true}).click();await expect(main.locator('[data-career-application]').first()).toHaveAttribute('data-career-application',rows[50].id);
 const appSearch=main.getByRole('textbox',{name:lang==='cs'?'Hledat odeslané přihlášky':'Search sent applications',exact:true});await appSearch.fill('1200');await expect(main.locator('[data-career-application]')).toHaveCount(1);await expect(main.locator('[data-career-application]')).toHaveAttribute('data-career-application',rows[1200].id);
 await appSearch.fill('');await expect(appPager.getByRole('status')).toHaveText(t.pageRange(1,50,1201));expect(reads).toBe(6);expect(refreshes).toBe(0);
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);}
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('main').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);expect(errors).toEqual([]);
});
