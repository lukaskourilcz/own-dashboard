import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { professional } from '../src/lib/i18n/sections/professional';
import { mondayKey, previousMondayKey } from '../src/lib/date-keys';
const owner = '11111111-1111-4111-8111-111111111111', setId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
for (const lang of ['en','cs'] as const) test(`${lang}: weekly focus refuses an invented empty recap and keeps complete long rows after recovery`, async ({ page }, info) => {
  const errors = watchConsole(page), t = professional[lang]; let mode: 'failed' | 'saved' = 'failed', reads = 0, writes = 0;
  await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.route('**/rest/v1/weekly_reviews?**', route => {
    if (route.request().method() !== 'GET') { writes++; return route.fulfill({ status: 405, json: {} }); }
    return route.fulfill({ json: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner, week_start: mondayKey(), status: 'draft', summary: 'Retained review',
      items: { step: 'done' }, completed_at: null, created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T09:00:00Z' }] });
  });
  await page.route('**/rest/v1/rpc/weekly_focus_snapshot', route => {
    reads++; expect(route.request().postDataJSON()).toEqual({ p_week_start: previousMondayKey() });
    if (mode === 'failed') return route.fulfill({ status: 503, json: { message: 'Private fixture transport failure' } });
    return route.fulfill({ json: { ownerId: owner, weekStart: previousMondayKey(), sets: [{ id: setId, user_id: owner, focus_date: previousMondayKey(), generation: 1201, items: [
      { id: itemId, user_id: owner, set_id: setId, todo_id: null, position: 1,
        title_snapshot: 'A'.repeat(220), project_name_snapshot: 'Projekt'.repeat(35), completed_at: '2026-10-24T09:00:00.123456Z' },
    ] }] } });
  });
  await page.goto('/dev-preview?tab=work&planning=live');
  const card = page.getByTestId('weekly-planning');
  await expect(card.getByRole('heading', { name: t.weeklyPlanning, exact: true })).toBeVisible();
  await expect(card.getByRole('alert')).toContainText(t.focusRecapLoadFailed);
  await expect(card.getByText(t.focusRecapEmpty, { exact: true })).toHaveCount(0);
  await expect(card.getByText('0/0', { exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: t.planningNext, exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: t.completeWeek, exact: true })).toBeDisabled();
  await expect(card.getByRole('button', { name: t.saveDraft, exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="weekly-planning"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  const before = reads; mode = 'saved';
  await card.getByRole('button', { name: t.planningRetry, exact: true }).click();
  await expect(card.getByTestId('weekly-focus-item')).toHaveCount(1); expect(reads).toBe(before + 1);
  await expect(card.getByRole('alert')).toHaveCount(0);
  await expect(card.getByText('1/1', { exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: t.planningNext, exact: true })).toBeEnabled();
  await expect(card.getByRole('button', { name: t.completeWeek, exact: true })).toBeEnabled();
  for (const width of [360,430,768,1024,1440,1728]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(async () => { const box = (await card.boundingBox())!; return box.x >= 0 && box.x + box.width <= width + 1; }).toBe(true);
    for (const id of ['weekly-focus-title','weekly-focus-project']) {
      const content = card.getByTestId(id);
      await expect(content).toBeVisible();
      await expect.poll(() => content.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      await expect.poll(() => content.evaluate(element => {
        const parent = element.closest('[data-testid="weekly-planning"]')!.getBoundingClientRect();
        const bounds = element.getBoundingClientRect();
        return bounds.left >= parent.left && bounds.right <= parent.right + 1;
      })).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 900 });
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="weekly-planning"]').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  if (lang === 'cs') await card.screenshot({ path: `/tmp/app-audit-weekly-focus-recovery-cs-${info.project.name}.png` });
  expect(writes).toBe(0);
  expect(errors.filter(error => !(error.includes('503') && error.includes('/rpc/weekly_focus_snapshot')))).toEqual([]);
});
