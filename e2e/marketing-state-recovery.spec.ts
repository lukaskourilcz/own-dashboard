import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { marketingStateFixture, stateOwner } from '../tests/lib/marketing-state-fixture';
import { marketingWorkspace } from '../src/lib/i18n/sections/marketing-workspace';
import { writeFileSync } from 'node:fs';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];

for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
 test(`${lang}/${theme}: checked records survive a refused refresh and recover through one explicit read`, async ({ page }, info) => {
  const errors = watchConsole(page), t = marketingWorkspace[lang], owners: Array<string | undefined> = [], writes: string[] = [];
  let failed = false;
  await page.clock.setFixedTime(new Date('2026-10-29T10:00:00Z'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if (info.project.name === 'mobile') await page.setViewportSize({ width: 430, height: 900 });
  page.on('request', request => { if (request.url().includes('/api/marketing/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.route('**/api/marketing/state', route => {
   owners.push(route.request().headers()['x-own-dashboard-owner']);
   const value = marketingStateFixture();
   if (failed) { value.ownerId = '99999999-9999-4999-8999-999999999999'; value.revisions[0].revision.title = 'UNCONFIRMED_DRAFT'; }
   return route.fulfill({ json: value });
  });
  await gotoPreview(page, { lang, theme }); await page.goto('/dev-preview?tab=marketing&marketingState=live');
  const workspace = page.getByTestId('marketing-workspace');
  await expect(workspace.getByRole('heading', { name: 'Reviewed draft', exact: true })).toBeVisible();
  const beforeRefresh = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(new Date(beforeRefresh + 60_000));
  expect(await page.evaluate(() => Date.now())).toBe(beforeRefresh + 60_000); expect(owners).toEqual([stateOwner]);
  failed = true; await workspace.getByRole('button', { name: t.refresh, exact: true }).click();
  const notice = workspace.getByRole('alert'); await expect(notice).toContainText(t.retainedState);
  await expect(workspace.getByRole('heading', { name: 'Reviewed draft', exact: true })).toBeVisible();
  await expect(workspace).not.toContainText('UNCONFIRMED_DRAFT');
  const checkedAt = Date.parse((await notice.locator('time').getAttribute('datetime'))!);
  expect(checkedAt).toBeLessThanOrEqual(beforeRefresh); expect(await page.evaluate(() => Date.now()) - checkedAt).toBeGreaterThanOrEqual(60_000);
  await expect(workspace.getByRole('button', { name: t.edit, exact: true })).toBeDisabled();
  const widths = info.project.name === 'desktop' ? [360, 430, 768, 1024, 1440, 1728] : [430];
  for (const width of widths) {
   await page.setViewportSize({ width, height: 900 }); await notice.scrollIntoViewIfNeeded();
   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
   expect((await new AxeBuilder({ page: page as unknown as AxePage }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
   if (lang === 'cs' && theme === 'dark' && ((info.project.name === 'desktop' && width === 1440) || info.project.name === 'mobile')) {
    await page.locator('.mac-content-scroll').evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => window.scrollTo(0, 0));
    const box = (await workspace.boundingBox())!, noticeBox = (await notice.boundingBox())!;
    const clip = { x: box.x, y: box.y, width: box.width, height: noticeBox.y + noticeBox.height - box.y + 8 };
    expect(clip.y).toBeGreaterThanOrEqual(0); expect(clip.y + clip.height).toBeLessThanOrEqual(900);
    const controls = [notice, notice.locator('time'), workspace.getByRole('button', { name: t.refresh, exact: true })];
    const marks = [];
    for (const [index, control] of controls.entries()) { const target = (await control.boundingBox())!; marks.push({ n: index + 1, x: (target.x - clip.x) / clip.width * 100, y: (target.y - clip.y) / clip.height * 100, w: target.width / clip.width * 100, h: target.height / clip.height * 100 }); }
    await page.screenshot({ path: info.outputPath(`marketing-state-recovery-cs-${width}.png`), clip });
    writeFileSync(info.outputPath(`marketing-state-recovery-cs-${width}.json`), JSON.stringify({ clip, marks }, null, 2) + '\n');
   }
  }
  await workspace.locator('#marketing-tab-calendar').click(); await expect(workspace).toContainText('Reviewed plan');
  expect(owners).toEqual([stateOwner, stateOwner]);
  failed = false; const refresh = workspace.getByRole('button', { name: t.refresh, exact: true }); await refresh.focus(); await refresh.press('Enter');
  await expect(notice).toHaveCount(0); await expect(workspace).toContainText('Reviewed plan');
  expect(owners).toEqual([stateOwner, stateOwner, stateOwner]);
  await expect(workspace.getByRole('button', { name: lang === 'cs' ? 'Použít tento plán' : 'Use this plan', exact: true })).toBeDisabled();
  expect(writes).toEqual([]); expect(errors).toEqual([]);
 });
}
