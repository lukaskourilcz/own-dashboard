import { expect, test } from '@playwright/test';
import { gotoPreview } from './helpers';
import { plans } from '../src/lib/i18n/sections/plans';
import { notes } from '../src/lib/i18n/sections/notes';
const blur=async(page:import('@playwright/test').Page)=>page.evaluate(()=>{if(document.activeElement instanceof HTMLElement)document.activeElement.blur();});
for(const lang of ['en','cs'] as const){
 test(`${lang}: the Goals chord works and editable/modal widgets keep their own keys`,async({page})=>{
  await gotoPreview(page,{lang});await blur(page);await page.keyboard.press('g');await page.keyboard.press('g');await expect(page.getByRole('button',{name:plans[lang].newPlan,exact:true})).toBeVisible();await expect(page).toHaveURL(/\/goals$/);
  await page.getByRole('button',{name:plans[lang].newPlan,exact:true}).click();const dialog=page.getByRole('dialog',{name:plans[lang].newPlan,exact:true}),title=dialog.getByLabel(plans[lang].formTitle,{exact:true});await title.fill('Retained keyboard draft ');await page.keyboard.type('g h');await expect(title).toHaveValue('Retained keyboard draft g h');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page).toHaveURL(/\/goals$/);
  await dialog.getByRole('combobox',{name:plans[lang].status,exact:true}).click();await page.keyboard.press('g');await page.keyboard.press('h');await expect(page.getByRole('listbox')).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).toHaveCount(1);await expect(page).toHaveURL(/\/goals$/);await expect(title).toHaveValue('Retained keyboard draft g h');
 });
 test(`${lang}: navigation chords expire or cancel after other keys and retain ordinary Home navigation`,async({page})=>{
  await gotoPreview(page,{lang});await page.goto('/dev-preview?tab=notes');await page.getByRole('button',{name:notes[lang].importMd,exact:true}).waitFor();await blur(page);
  for(const key of ['Escape','v']){await page.keyboard.press('g');await page.keyboard.press(key);await page.keyboard.press('h');expect(new URL(page.url()).pathname).toBe('/dev-preview');}
  await page.keyboard.press('g');await page.waitForTimeout(1601);await page.keyboard.press('h');expect(new URL(page.url()).pathname).toBe('/dev-preview');
  await page.keyboard.press('g');await page.evaluate(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'x',ctrlKey:true,bubbles:true})));await page.keyboard.press('h');expect(new URL(page.url()).pathname).toBe('/dev-preview');
  await page.keyboard.press('g');await page.getByRole('button',{name:notes[lang].importMd,exact:true}).focus();await page.keyboard.press('h');expect(new URL(page.url()).pathname).toBe('/dev-preview');await blur(page);
  await page.keyboard.press('g');await page.keyboard.press('h');await expect(page).toHaveURL(/\/$/);
 });
}
