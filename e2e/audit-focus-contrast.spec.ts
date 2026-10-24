import {test,expect,type Locator} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {writeFileSync} from 'node:fs';
import {gotoPreview,watchConsole} from './helpers';
import {calendar} from '../src/lib/i18n/sections/calendar';
async function focusContrast(control:Locator){
 await control.focus();await expect(control).toBeFocused();
 const read=()=>control.evaluate(element=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=1;const context=canvas.getContext('2d')!;
  const rgba=(css:string)=>{context.clearRect(0,0,1,1);context.fillStyle='rgba(0,0,0,0)';context.fillStyle=css;context.fillRect(0,0,1,1);const values=Array.from(context.getImageData(0,0,1,1).data);return [values[0],values[1],values[2],values[3]/255];};
  const over=(top:number[],bottom:number[])=>{const alpha=top[3]+bottom[3]*(1-top[3]);return [...[0,1,2].map(i=>alpha?(top[i]*top[3]+bottom[i]*bottom[3]*(1-top[3]))/alpha:0),alpha];};
  let background=[0,0,0,0];const ancestors:Element[]=[];for(let parent=element.parentElement;parent;parent=parent.parentElement)ancestors.unshift(parent);
  for(const parent of ancestors)background=over(rgba(getComputedStyle(parent).backgroundColor),background);
  const style=getComputedStyle(element),ring=rgba(style.getPropertyValue('--ring').trim()),painted=over(ring,background);
  const luminance=(color:number[])=>{const c=color.slice(0,3).map(value=>{const n=value/255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4;});return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
  const [low,high]=[luminance(painted),luminance(background)].sort((a,b)=>a-b);
  const colors=(style.boxShadow.match(/(?:rgba?|color)\([^)]*\)/g)??[]).map(rgba);
  return{focusVisible:element.matches(':focus-visible'),shadow:style.boxShadow,ring,background,ratio:(high+.05)/(low+.05),hasRing:colors.some(color=>color.every((value,i)=>Math.abs(value-ring[i])<.01))};
 });
 await expect.poll(async()=>(await read()).hasRing).toBe(true);
 return read();
}
for(const lang of ['en','cs'] as const)for(const theme of ['light','dark'] as const)test(`${lang} ${theme}: native focus indicators contrast on shared buttons and fields`,async({page},info)=>{
 const errors=watchConsole(page),t=calendar[lang],samples=[];await gotoPreview(page,{lang,theme});await page.emulateMedia({colorScheme:theme==='dark'?'light':'dark',reducedMotion:'reduce'});await page.goto('/dev-preview?tab=calendar');
 expect(await page.locator('html').evaluate(element=>getComputedStyle(element).colorScheme)).toBe(theme);
 const opener=page.getByRole('button',{name:t.newEvent,exact:true});await page.keyboard.press('Tab');
 for(const width of [360,430,768,1024,1440,1728]){await page.setViewportSize({width,height:1000});const sample=await focusContrast(opener);expect(sample.focusVisible).toBe(true);expect(sample.hasRing).toBe(true);samples.push({control:'button',width,...sample});}
 await opener.click();const dialog=page.getByRole('dialog',{name:t.newEvent,exact:true});
 for(const [name,control]of [['input',dialog.getByLabel(t.title,{exact:true})],['textarea',dialog.getByLabel(t.description,{exact:true})],['select',dialog.getByRole('combobox',{name:t.repeats,exact:true})]] as const){const sample=await focusContrast(control);expect(sample.focusVisible).toBe(true);expect(sample.hasRing,JSON.stringify({control:name,...sample})).toBe(true);samples.push({control:name,width:1728,...sample});}
 expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[role="dialog"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
 if(lang==='cs'){await page.setViewportSize({width:info.project.name==='mobile'?360:1440,height:1000});await dialog.getByLabel(t.title,{exact:true}).focus();await dialog.screenshot({path:`/tmp/app-audit-focus-${theme}-cs-${info.project.name}.png`});}
 await page.keyboard.press('Escape');await page.goto('/dev-preview?tab=tasks');await page.keyboard.press('Tab');
 const checkbox=page.locator('button[role="checkbox"].focus-ring').first();const sample=await focusContrast(checkbox);expect(sample.focusVisible).toBe(true);samples.push({control:'checkbox',width:page.viewportSize()!.width,...sample});
 writeFileSync(`/tmp/app-audit-focus-${theme}-${lang}-${info.project.name}.json`,JSON.stringify(samples,null,2)+'\n');for(const sample of samples)expect(sample.ratio,`${sample.control} at ${sample.width}px`).toBeGreaterThanOrEqual(3);expect(errors).toEqual([]);
});

test('forced colors retain a native visible focus outline when shadows are removed',async({page})=>{
 await gotoPreview(page);await page.emulateMedia({forcedColors:'active',reducedMotion:'reduce'});await page.goto('/dev-preview?tab=calendar');await page.keyboard.press('Tab');const opener=page.getByRole('button',{name:calendar.en.newEvent,exact:true});await opener.focus();await expect(opener).toBeFocused();
 const readOutline=(control:Locator)=>control.evaluate(element=>{const css=getComputedStyle(element);return{visible:element.matches(':focus-visible'),style:css.outlineStyle,width:parseFloat(css.outlineWidth)};});
 const verify=async(control:Locator)=>{await control.focus();await expect(control).toBeFocused();await expect.poll(async()=>(await readOutline(control)).width).toBeGreaterThanOrEqual(2);const outline=await readOutline(control);expect(outline.visible).toBe(true);expect(outline.style).toBe('solid');expect(outline.width).toBeGreaterThanOrEqual(2);};
 await verify(opener);await opener.click();const dialog=page.getByRole('dialog',{name:calendar.en.newEvent,exact:true});
 for(const control of [dialog.getByLabel(calendar.en.title,{exact:true}),dialog.getByLabel(calendar.en.description,{exact:true}),dialog.getByRole('combobox',{name:calendar.en.repeats,exact:true})])await verify(control);
});

test('print keeps native paper controls light independently of the dark app theme',async({page})=>{
 await gotoPreview(page,{theme:'dark'});await page.emulateMedia({media:'print',colorScheme:'dark',reducedMotion:'reduce'});const paper=await page.locator('body').evaluate(element=>{const style=getComputedStyle(element);return{colorScheme:style.colorScheme,background:style.backgroundColor};});expect(paper).toEqual({colorScheme:'light',background:'rgb(255, 255, 255)'});
});
