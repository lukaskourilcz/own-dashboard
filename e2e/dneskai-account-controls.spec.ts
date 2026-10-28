import { writeFileSync } from 'node:fs';
import { test, expect, type Page, type Locator } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiAccount } from '../src/lib/i18n/sections/dneskai-account';
import { dneskaiWorkspace } from '../src/lib/i18n/sections/dneskai-workspace';
import { common } from '../src/lib/i18n/sections/common';
const owner = '11111111-1111-4111-8111-111111111111';
const account = () => ({ id: '44444444-4444-4444-8444-444444444444', brand: 'dneskai', platform: 'instagram', handle: 'dneskai', verifiedAt: '2026-10-20T10:00:00.123456Z', updatedAt: '2026-10-20T10:00:00.123456Z', enabled: false,
  token: { expiresAt: '2099-12-19T10:00:00Z', refreshedAt: '2026-10-20T10:00:00.123456Z', scopes: ['instagram_business_basic', 'instagram_business_content_publish', 'instagram_business_manage_comments'], loginMode: 'instagram' },
  engagement: { enabled: false, blockedCode: null, blockedAt: null, webhook: true } });
async function open(page: Page, lang: 'en' | 'cs' = 'en', theme: 'light' | 'dark' = 'light') {
  await page.route('**/api/vercel/analytics?**', route => route.fulfill({ json: { kind: 'unconfigured' } }));
  await page.route('**/api/marketing/accounts/webhook', route => route.fulfill({ json: { subscribed: false } }));
  await gotoPreview(page, { lang, theme });
  await page.goto('/dev-preview?project=dneskai&accounts=live');
  await page.getByTestId('dneskai-more').click();
  await page.getByTestId('dneskai-more-menu').getByRole('button', { name: dneskaiWorkspace[lang].more.account, exact: true }).click();
  await expect(page.getByTestId('dneskai-instagram-account')).toContainText('@');
  return page.getByTestId('dneskai-more-account');
}
async function capture(panel: Locator, path: string, selectors: string[]) {
  const box = (await panel.boundingBox())!;
  const marks = [];
  for (const [index, selector] of selectors.entries()) {
    const target = (await panel.locator(selector).first().boundingBox())!;
    marks.push({ n: index + 1, x: 100 * (target.x - box.x) / box.width, y: 100 * (target.y - box.y) / box.height, w: 100 * target.width / box.width, h: 100 * target.height / box.height });
  }
  await panel.screenshot({ path });
  writeFileSync(path.replace('.png', '.json'), JSON.stringify({ box, marks }, null, 2) + '\n');
}
for (const width of [360, 430, 768, 1024, 1440, 1728]) for (const lang of ['en', 'cs'] as const) for (const theme of ['light', 'dark'] as const) {
  test(`account dialog reflows, retains cached data and passes axe: ${width} ${lang} ${theme}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 1100 });
    const errors = watchConsole(page), before = { ...account(), handle: 'dneskai_' + 'dlouhy_nazev_'.repeat(7) }; let unavailable = false;
    await page.route('**/api/marketing/accounts', route => route.fulfill(unavailable ? { status: 503, json: { error: 'account-store-failed' } } : { json: { accounts: [before] } }));
    const panel = await open(page, lang, theme), block = page.getByTestId('dneskai-instagram-account');
    const publishing = block.getByTestId('dneskai-publishing-switch').getByRole('button');
    await expect(publishing).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(await block.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const actions = [publishing, block.getByTestId('dneskai-engagement-switch').getByRole('button', { name: dneskaiAccount[lang].engagement.enable, exact: true }), block.getByRole('button', { name: dneskaiAccount[lang].verify, exact: true })];
    for (const action of actions) expect((await action.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const reply = actions[1];
    expect(Math.abs((await publishing.boundingBox())!.width - (await reply.boundingBox())!.width)).toBeLessThan(1);
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(576);
    await block.locator('summary').filter({ hasText: dneskaiAccount[lang].scopes }).click();
    expect(await block.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    const axe = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-more-account"]').withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations).toEqual([]);
    if (lang === 'cs' && theme === 'dark' && [430, 1440].includes(width)) await capture(panel, info.outputPath(`account-controls-cs-${width}.png`), ['dl', '[data-testid="dneskai-publishing-switch"] button', '[data-testid="dneskai-engagement-switch"] button']);
    unavailable = true;
    await page.keyboard.press('Escape'); await expect(panel).not.toBeVisible(); await expect(page.getByTestId('dneskai-more')).toBeFocused();
    await page.getByTestId('dneskai-more').click(); await page.getByTestId('dneskai-more-menu').getByRole('button', { name: dneskaiWorkspace[lang].more.account, exact: true }).click();
    await expect(block).toContainText(dneskaiAccount[lang].cachedUnavailable); await expect(block).toContainText(before.handle); await expect(publishing).toBeDisabled();
    if (lang === 'cs' && theme === 'dark' && [430, 1440].includes(width)) await capture(panel, info.outputPath(`account-recovery-cs-${width}.png`), ['[data-testid="dneskai-account-recovery"]', 'dl', '[data-testid="dneskai-publishing-switch"] button']);
    unavailable = false; await block.getByTestId('dneskai-account-recovery').getByRole('button').click(); await expect(publishing).toBeEnabled();
    expect(errors.filter(error => !error.includes('503 (Service Unavailable)'))).toEqual([]);
  });
}
test('one captured save guards Escape, waits for confirmation, then restores focus without another account GET', async ({ page }) => {
  const errors = watchConsole(page), before = account(); let reads = 0, release!: () => void; const pending = new Promise<void>(resolve => { release = resolve; }), writes: unknown[] = [];
  await page.route('**/api/marketing/accounts', route => { reads++; return route.fulfill({ json: { accounts: [before] } }); });
  await page.route('**/api/marketing/accounts/enable', async route => { const input = route.request().postDataJSON(); writes.push(input); await pending; await route.fulfill({ json: { receipt: { kind: 'saved', ownerId: owner, id: before.id, expectedVersion: before.updatedAt, switch: 'publishing', requestedEnabled: true, updatedAt: '2026-10-20T10:00:00.123457Z' } } }); });
  const panel = await open(page), initialReads = reads, button = panel.getByTestId('dneskai-publishing-switch').getByRole('button');
  page.on('dialog', dialog => dialog.accept());
  await button.click(); await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({ ownerId: owner, accountId: before.id, expectedVersion: before.updatedAt, enabled: true });
  await page.keyboard.press('Escape');
  const guard = page.getByRole('dialog', { name: common.en.unsaved.pendingTitle }); await expect(guard).toBeVisible(); await expect(guard.getByRole('button', { name: common.en.unsaved.discard })).toBeDisabled();
  release(); await expect(panel).not.toBeVisible(); await expect(guard).not.toBeVisible(); await expect(page.getByTestId('dneskai-more')).toBeFocused();
  expect(reads).toBe(initialReads); expect(writes).toHaveLength(1); expect(errors).toEqual([]);
});
test('unconfirmed save holds replay and a fresh read restores the same account controls', async ({ page }) => {
  const before = account(); let writes = 0, reads = 0;
  await page.route('**/api/marketing/accounts', route => { reads++; return route.fulfill({ json: { accounts: [before] } }); });
  await page.route('**/api/marketing/accounts/enable', route => { writes++; return route.fulfill({ status: 503, json: { error: 'account-store-failed' } }); });
  const panel = await open(page), initialReads = reads, block = page.getByTestId('dneskai-instagram-account'), button = panel.getByTestId('dneskai-publishing-switch').getByRole('button');
  page.on('dialog', dialog => dialog.accept()); await button.click(); await expect(button).toBeDisabled(); await expect(block.getByTestId('dneskai-account-recovery')).toBeVisible(); expect(writes).toBe(1);
  await block.getByTestId('dneskai-account-recovery').getByRole('button').click(); await expect(button).toBeEnabled(); expect(writes).toBe(1); expect(reads).toBe(initialReads + 1);
});
test('other More panels still close with Escape and restore focus', async ({ page }) => {
  await gotoPreview(page); await page.route('**/api/vercel/analytics?**', route => route.fulfill({ json: { kind: 'unconfigured' } })); await page.goto('/dev-preview?project=dneskai');
  for (const kind of ['costs', 'recovery', 'shortcuts'] as const) {
    await page.getByTestId('dneskai-more').click(); await page.getByTestId('dneskai-more-menu').getByRole('button', { name: dneskaiWorkspace.en.more[kind], exact: true }).click();
    await expect(page.getByTestId(`dneskai-more-${kind}`)).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByTestId(`dneskai-more-${kind}`)).not.toBeVisible(); await expect(page.getByTestId('dneskai-more')).toBeFocused();
  }
});
for (const lang of ['en','cs'] as const) test(`captured verification conflict has one message and keyboard recovery: ${lang}`, async ({page},info) => {
  await page.setViewportSize({width:info.project.name==='mobile'?430:1440,height:1100});
  let reads = 0, writes = 0;
  await page.route('**/api/marketing/accounts', route => { reads++; return route.fulfill({json:{accounts:[account()]}}); });
  await page.route('**/api/marketing/accounts/verify', route => { writes++; return route.fulfill({status:409,json:{error:'account-changed'}}); });
  const errors = watchConsole(page), panel = await open(page,lang,lang==='cs'?'dark':'light'), before = reads, t = dneskaiAccount[lang];
  const verify = panel.getByRole('button',{name:t.verify,exact:true}); await verify.focus(); await verify.press('Enter');
  await expect(panel.getByRole('alert')).toHaveCount(1); await expect(panel.getByRole('alert')).toHaveText(t.changed); await expect(verify).toBeDisabled();
  const reload = panel.getByRole('button',{name:t.reload,exact:true}); await expect(reload).toBeFocused();
  const details = panel.locator('summary').filter({hasText:t.details}); await details.click(); await expect(panel.getByText(t.intro,{exact:true})).toBeVisible();
  expect(await panel.evaluate(element=>element.scrollWidth<=element.clientWidth+1)).toBe(true); await details.click(); await reload.focus();
  expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).include('[data-testid="dneskai-more-account"]').withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze()).violations).toEqual([]);
  if(lang==='cs') await capture(panel,info.outputPath(`account-verification-conflict-cs-${info.project.name==='mobile'?430:1440}.png`),['[role="alert"]','[data-testid="dneskai-account-recovery"] button','dl']);
  await reload.press('Enter'); await expect(verify).toBeEnabled(); await expect(verify).toBeFocused(); expect(reads).toBe(before+1); expect(writes).toBe(1);
  expect(errors.filter(error=>!error.includes('409 (Conflict)'))).toEqual([]);
});
