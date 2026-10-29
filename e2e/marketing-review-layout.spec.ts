import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { readFileSync, writeFileSync } from 'node:fs';
import { gotoPreview, watchConsole } from './helpers';
import { marketingStateFixture, stateId, stateOwner } from '../tests/lib/marketing-state-fixture';
import { marketingWorkspace } from '../src/lib/i18n/sections/marketing-workspace';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
 test(`${lang}/${theme}: review fits text-only and image posts without a blank media column`, async ({ page }, info) => {
  const errors = watchConsole(page), t = marketingWorkspace[lang], writes: string[] = [], owners: Array<string | undefined> = [];
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00Z')); await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 430, height: 900 });
  const value = marketingStateFixture(); value.revisions[0].ready = true;
  value.revisions[0].revision.caption = 'Authored draft with a long reference: ' + 'abcdefghij'.repeat(22);
  const image = structuredClone(value.revisions[0]); image.id = stateId(21); image.revision.title = 'Image draft'; image.revision.format = 'post'; image.revision.account.platform = 'instagram';
  image.revision.assets = [{ url: 'https://example.test/review-image.jpg', sha256: 'c'.repeat(64), mimeType: 'image/jpeg', width: 1080, height: 1350, alt: 'Checked-in preview photograph' }];
  const missing = structuredClone(image); missing.id = stateId(22); missing.revision.title = 'Missing artwork draft'; missing.revision.assets = []; missing.ready = false;
  value.revisions.push(image, missing);
  page.on('request', request => { if (request.url().includes('/api/marketing/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.route('https://example.test/review-image.jpg', route => route.fulfill({ contentType: 'image/jpeg', body: readFileSync('public/demo/dneskai/photo-p1.jpg') }));
  await page.route('**/api/marketing/state', route => { owners.push(route.request().headers()['x-own-dashboard-owner']); return route.fulfill({ json: value }); });
  await gotoPreview(page, { lang, theme }); await page.goto('/dev-preview?tab=marketing&marketingState=live');
  const workspace = page.getByTestId('marketing-workspace'); await expect(workspace.getByRole('heading', { name: 'Reviewed draft', exact: true })).toBeVisible();
  const textCard = workspace.locator('article').filter({ has: page.getByRole('heading', { name: 'Reviewed draft', exact: true }) });
  const imageCard = workspace.locator('article').filter({ has: page.getByRole('heading', { name: 'Image draft', exact: true }) });
  const missingCard = workspace.locator('article').filter({ has: page.getByRole('heading', { name: 'Missing artwork draft', exact: true }) });
  await expect(textCard).not.toContainText(t.notReady); await expect(textCard.locator('figure,img,video')).toHaveCount(0);
  await expect(missingCard.getByText(t.notReady, { exact: true })).toBeVisible(); await expect(missingCard.locator('figure,img,video')).toHaveCount(0);
  await imageCard.locator('img').scrollIntoViewIfNeeded();
  await expect.poll(() => imageCard.locator('img').evaluate(element => (element as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  const widths = info.project.name === 'desktop' ? [360, 430, 768, 1024, 1440, 1728] : [430];
  for (const width of widths) {
   await page.setViewportSize({ width, height: 900 }); await textCard.scrollIntoViewIfNeeded();
   expect(await textCard.getByTestId('marketing-review-body').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1);
   expect(await imageCard.getByTestId('marketing-review-body').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(width >= 1024 ? 2 : 1);
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
   const textBox = (await textCard.boundingBox())!, imageBox = (await imageCard.boundingBox())!, outer = (await workspace.boundingBox())!;
   expect(textBox.width).toBeLessThanOrEqual(768); expect(Math.abs(textBox.x + textBox.width / 2 - outer.x - outer.width / 2)).toBeLessThan(1);
   if (width >= 1440) expect(imageBox.width).toBeGreaterThan(textBox.width);
   const buttons = await textCard.locator('footer button').evaluateAll(elements => elements.map(element => { const box = element.getBoundingClientRect(); return { width: box.width, height: box.height }; }));
   expect(Math.max(...buttons.map(box => box.width)) - Math.min(...buttons.map(box => box.width))).toBeLessThan(1);
   expect(Math.max(...buttons.map(box => box.height)) - Math.min(...buttons.map(box => box.height))).toBeLessThan(1);
   expect(Math.min(...buttons.map(box => box.height))).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
   expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
   if (lang === 'cs' && theme === 'dark' && ((info.project.name === 'desktop' && width === 1440) || info.project.name === 'mobile')) {
    await textCard.evaluate(element => element.scrollIntoView({ block: 'center' }));
    const clip = (await textCard.boundingBox())!; expect(clip.y).toBeGreaterThanOrEqual(0); expect(clip.y + clip.height).toBeLessThanOrEqual(900);
    await page.screenshot({ path: info.outputPath(`marketing-text-review-cs-${width}.png`), clip });
    const controls = [textCard.getByRole('heading'), textCard.getByTestId('marketing-review-body'), textCard.locator('footer')], marks = [];
    for (const [index, control] of controls.entries()) { const box = (await control.boundingBox())!; marks.push({ n: index + 1, x: (box.x - clip.x) / clip.width * 100, y: (box.y - clip.y) / clip.height * 100, w: box.width / clip.width * 100, h: box.height / clip.height * 100 }); }
    writeFileSync(info.outputPath(`marketing-text-review-cs-${width}.json`), JSON.stringify({ clip, marks }, null, 2) + '\n');
   }
  }
  await textCard.getByText(t.source, { exact: true }).focus(); await page.keyboard.press('Enter'); await expect(textCard.getByRole('link', { name: 'Reviewed source' })).toBeVisible();
  for (const button of await textCard.getByRole('button').all()) await expect(button).toBeDisabled();
  expect(owners).toEqual([stateOwner]); expect(writes).toEqual([]); expect(errors).toEqual([]);
 });
}
