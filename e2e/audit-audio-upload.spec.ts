import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFileSync} from 'node:fs';
import {gotoPreview,watchConsole} from './helpers';
import {dneskaiAudio} from '../src/lib/i18n/sections/dneskai-audio';
import {common} from '../src/lib/i18n/sections/common';
import {DEMO_DNESKAI_AUDIO_TRACKS} from '../src/lib/marketing/dneskai-audio-client';
const owner='11111111-1111-4111-8111-111111111111';
for(const lang of ['en','cs'] as const)test(`${lang}: retained upload protects pending exits and retries one original file`,async({page},info)=>{
 const t=dneskaiAudio[lang],errors=watchConsole(page);let uploadId='',puts=0,creates=0,saved=false,release:()=>void=()=>{};
 const bodies:Record<string,unknown>[]=[];
 const track=()=>({...DEMO_DNESKAI_AUDIO_TRACKS[0],id:uploadId,title:'Fixture upload',artist:'Fixture artist',source:'original',sourceUrl:'https://example.test/audio',licenceNote:'Own fixture recording',mood:['calm'],enabled:false});
 await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
 await page.route('**/api/marketing/dneskai/audio',async route=>{
  if(route.request().method()==='GET')return route.fulfill({json:{tracks:saved?[track()]:[],trends:[],trendsStatus:'disabled',nextOffset:null}});
  const input=route.request().postDataJSON();bodies.push(input);expect(input.ownerId).toBe(owner);
  if(input.action==='prepare'){expect(uploadId).toBe('');uploadId=input.uploadId;return route.fulfill({json:{ownerId:owner,uploadId,path:owner+'/'+uploadId+'.mp3',token:'set'}});}
  expect(input.action).toBe('create');expect(input.uploadId).toBe(uploadId);creates++;
  if(creates===1){await new Promise<void>(resolve=>{release=resolve;});saved=true;return route.fulfill({status:503,json:{error:'audio-library-unavailable'}});}
  return route.fulfill({json:{ownerId:owner,track:track()}});
 });
 await page.route('**/storage/v1/object/upload/sign/marketing-audio/**',route=>{puts++;expect(new URL(route.request().url()).pathname).toBe('/storage/v1/object/upload/sign/marketing-audio/'+owner+'/'+uploadId+'.mp3');return route.fulfill({json:{Key:'marketing-audio/'+owner+'/'+uploadId+'.mp3'}});});
 await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music&music=live');
 await page.getByTestId('dneskai-audio-library').getByRole('button',{name:t.upload.title,exact:true}).click();
 const form=page.getByTestId('dneskai-audio-upload'),dialog=page.getByRole('dialog',{name:t.upload.title,exact:true}),title=form.getByLabel(t.upload.trackTitle,{exact:true});
 await title.fill('Fixture upload');
 await dialog.getByRole('button',{name:lang==='cs'?'Zavřít':'Close',exact:true}).click();
 let guard=page.getByRole('dialog',{name:common[lang].unsaved.title,exact:true});await expect(guard).toBeVisible();await guard.getByRole('button',{name:common[lang].unsaved.stay,exact:true}).click();
 await form.getByLabel(t.upload.file,{exact:true}).setInputFiles({name:'fixture.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('fixture')});
 await form.getByLabel(t.upload.artist,{exact:true}).fill('Fixture artist');await form.getByLabel(t.upload.source,{exact:true}).selectOption('original');
 await form.getByLabel(t.upload.sourceUrl,{exact:true}).fill('https://example.test/audio');await form.getByLabel(t.upload.licenceNote,{exact:true}).fill('Own fixture recording');await form.getByLabel(t.upload.mood,{exact:true}).fill('calm');
 await form.getByRole('button',{name:t.upload.submit,exact:true}).click();await expect.poll(()=>creates).toBe(1);await expect(title).toBeDisabled();
 await form.dispatchEvent('submit');expect(puts).toBe(1);expect(creates).toBe(1);
 await page.keyboard.press('Escape');
 guard=page.getByRole('dialog',{name:common[lang].unsaved.pendingTitle,exact:true});await expect(guard).toBeVisible();await expect(guard.getByRole('button',{name:common[lang].unsaved.discard,exact:true})).toBeDisabled();await guard.getByRole('button',{name:common[lang].unsaved.stay,exact:true}).click();
 release();await expect(form.getByRole('alert')).toHaveText(t.upload.unconfirmed);await expect(title).toHaveValue('Fixture upload');await expect(title).toHaveAttribute('readonly','');await expect(title).toBeEnabled();await expect(form.getByText(t.upload.retained,{exact:true})).toBeVisible();
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1100});expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);const retry=form.getByRole('button',{name:t.upload.retry,exact:true}),box=(await retry.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);const discard=(await form.getByRole('button',{name:t.upload.discard,exact:true}).boundingBox())!;expect(Math.abs(discard.width-box.width)).toBeLessThanOrEqual(1);}
 if(lang==='cs'){const width=info.project.name==='mobile'?430:1440;await page.setViewportSize({width,height:1200});const path=`test-results/audio-upload-recovery-cs-${width}`;await dialog.screenshot({path:path+'.png',animations:'disabled'});const box=(await dialog.boundingBox())!,marks=[];for(const [index,el]of [title,form.getByRole('button',{name:t.upload.retry,exact:true}),form.getByRole('button',{name:t.upload.discard,exact:true})].entries()){const rect=(await el.boundingBox())!;marks.push({n:index+1,x:100*(rect.x-box.x)/box.width,y:100*(rect.y-box.y)/box.height,w:100*rect.width/box.width,h:100*rect.height/box.height});}writeFileSync(path+'.json',JSON.stringify({viewport:{width,height:1200},box,marks},null,2)+'\n');}
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="dneskai-audio-upload"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 await form.getByRole('button',{name:t.upload.retry,exact:true}).focus();await page.keyboard.press('Enter');await expect(form.getByRole('status')).toHaveText(t.upload.done('Fixture upload'));expect(puts).toBe(1);expect(creates).toBe(2);expect(bodies.map(row=>row.action)).toEqual(['prepare','create','create']);expect(bodies[1]).toEqual(bodies[2]);await expect(title).toHaveValue('');await expect(form.getByLabel(t.upload.licenceNote,{exact:true})).toHaveValue('');
 await dialog.getByRole('button',{name:lang==='cs'?'Zavřít':'Close',exact:true}).click();await expect(dialog).toHaveCount(0);
 expect(errors.filter(error=>!/^Failed to load resource: the server responded with a status of 503 .*\(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/marketing\/dneskai\/audio\)$/.test(error))).toEqual([]);
});
