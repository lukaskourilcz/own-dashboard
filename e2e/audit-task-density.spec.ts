import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { todos } from '../src/lib/i18n/sections/todos';
import { common } from '../src/lib/i18n/sections/common';
import { nav } from '../src/lib/i18n/sections/nav';
const owner = '11111111-1111-4111-8111-111111111111';
for (const lang of ['en', 'cs'] as const) test(`${lang}: task rows preserve group limits, full text and consistent targets at six widths`, async ({ page }, info) => {
  const errors = watchConsole(page), t = todos[lang]; await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
  await page.clock.setFixedTime(new Date('2026-10-25T12:00:00Z'));
  const long = ('Žluťoučký dlouhý úkol s přesným zadáním a potřebným kontextem. ').repeat(8);
  const rows = Array.from({ length: 9 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, user_id: owner, title: index === 0 ? long : `TEST_ONLY task ${index}`, done: index === 8, importance: index === 1 ? 5 : null, task_kind: index === 1 ? 'deploy' : null, estimated_minutes: index === 1 ? 100000 : null, needed_raw: index === 1 ? '- [ ] Task [owner:ai]' : null, generated_at: index === 1 ? '2026-10-25T00:00:00Z' : null, source: 'manual', is_global: false, due_date: '2026-11-01', created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00.000001Z' }));
  let writes = 0; await page.route('**/rest/v1/rpc/write_task', route => { writes++; return route.fulfill({ status: 503, json: {} }); });
  await page.route('**/rest/v1/rpc/read_owned_collection', route => { expect(route.request().postDataJSON().p_entity).toBe('todos'); return route.fulfill({ json: rows }); });
  await page.goto('/dev-preview?tasks=live'); await page.getByRole('button', { name: nav[lang].sections.tasks, exact: true }).click();
  const main = page.getByRole('main'), group = main.locator('div.break-inside-avoid').filter({ has: page.getByText(t.personalGroup, { exact: true }) });
  await expect(group.locator('[data-task-id]')).toHaveCount(5);
  const expand = group.getByRole('button', { name: t.showAllCount(8), exact: true }); await expand.click(); await expect(group.locator('[data-task-id]')).toHaveCount(8); await expect(group.getByRole('button', { name: t.showLess, exact: true })).toHaveAttribute('aria-expanded', 'true');
  await group.getByRole('button', { name: t.showLess, exact: true }).click(); await expect(group.locator('[data-task-id]')).toHaveCount(5);
  const collapse = group.getByRole('button', { name: `${t.collapseGroup}: ${t.personalGroup}`, exact: true }); await collapse.click(); await expect(group.locator('[data-task-id]')).toHaveCount(0); await group.getByRole('button', { name: `${t.expandGroup}: ${t.personalGroup}`, exact: true }).click();
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    await page.setViewportSize({ width, height: 1000 });
    const first = group.locator('[data-task-id="00000000-0000-4000-8000-000000000000"]'), text = first.locator('p').first(), disclosure = first.getByRole('button', { name: t.showTaskText, exact: true });
    await expect(disclosure).toBeVisible(); const before = await text.boundingBox(); await disclosure.focus(); await page.keyboard.press('Enter'); await expect(first.getByRole('button', { name: t.hideTaskText, exact: true })).toHaveAttribute('aria-expanded', 'true'); expect((await text.boundingBox())!.height).toBeGreaterThan(before!.height); await expect(text).toHaveText(long.trim());
    await first.getByRole('button', { name: t.hideTaskText, exact: true }).click();
    const check = await first.getByRole('checkbox').boundingBox(), remove = await first.getByRole('button', { name: common[lang].delete, exact: true }).boundingBox(); expect(check!.width).toBe(width < 768 ? 44 : 32); expect(check!.height).toBe(remove!.height); expect(remove!.width).toBe(check!.width);
    for (const row of await group.locator('[data-task-id]').all()) expect(await row.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (width >= 1024) { const short = group.locator('[data-task-id]').nth(2); const title = await short.locator('p').first().boundingBox(); const metadata = await short.getByText(t.assigneeMe, { exact: true }).boundingBox(); expect(Math.abs(title!.y - metadata!.y)).toBeLessThanOrEqual(5); }
    const box = (await group.boundingBox())!, parent = (await group.locator('..').boundingBox())!; expect(Math.abs(box.x + box.width / 2 - (parent.x + parent.width / 2))).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await main.getByRole('button', { name: new RegExp('^'+t.finishedTitle) }).click(); await expect(main.locator('[data-task-id]').filter({ hasText: 'TEST_ONLY task 8' })).toBeVisible(); const finished = main.locator('div.overflow-hidden').filter({ has: page.getByRole('button', { name: new RegExp('^'+t.finishedTitle) }) }); await expect(finished).toBeVisible(); expect((await finished.boundingBox())!.width).toBe((await group.boundingBox())!.width);
  const finishedRow = main.locator('[data-task-id]').filter({ hasText: 'TEST_ONLY task 8' }); await finishedRow.scrollIntoViewIfNeeded();
  for (const action of [t.reopen, common[lang].delete]) {
    const hit = await finishedRow.getByRole('button', { name: action, exact: true }).evaluate(element => {
      const r = element.getBoundingClientRect();
      const points = [[r.left+r.width/2,r.top+r.height/2],[r.left+2,r.top+r.height/2],[r.right-2,r.top+r.height/2],[r.left+r.width/2,r.top+2],[r.left+r.width/2,r.bottom-2]].map(([x,y]) => ({ x, y, hit: document.elementFromPoint(x,y), clear: element.contains(document.elementFromPoint(x,y)) }));
      return { clear: points.every(point => point.clear), rect: { x:r.x,y:r.y,width:r.width,height:r.height }, viewport: { width:innerWidth,height:innerHeight }, points: points.map(point=>({x:point.x,y:point.y,clear:point.clear,hit:point.hit?.outerHTML.slice(0,300)})) };
    });
    expect(hit.clear, JSON.stringify(hit)).toBe(true);
  }
  if (lang === 'cs') { await page.setViewportSize({ width: info.project.name === 'mobile' ? 360 : 1440, height: 1000 }); await main.screenshot({ path: info.outputPath('task-rows-cs.png') }); }
  expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]); expect(writes).toBe(0); expect(errors).toEqual([]);
});
