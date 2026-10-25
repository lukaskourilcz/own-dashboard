import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview } from './helpers';
import { organizations } from '../src/lib/demo/fixtures';
import { common } from '../src/lib/i18n/sections/common';
import { professional } from '../src/lib/i18n/sections/professional';
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const record = { ...organizations[0], id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', user_id: owner };
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: complete organization reads refuse a failed or foreign response and recover explicitly`, async ({ page }) => {
        let state: 'failed' | 'foreign' | 'ok' = 'failed', reads = 0;
        const errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        await page.route('**/rest/v1/rpc/read_owned_collection', route => { if (route.request().postDataJSON().p_entity !== 'organizations')
            return route.fulfill({ json: [] }); reads++; return state === 'failed' ? route.fulfill({ status: 503, json: { message: 'PRIVATE TEST database detail' } }) : route.fulfill({ json: [{ ...record, user_id: state === 'foreign' ? other : owner }] }); });
        await page.goto('/dev-preview?tab=clients&organizations=live');
        const main = page.getByRole('main');
        await expect(main.getByRole('alert')).toHaveText(common[lang].dataUnavailableDescription);
        expect(reads).toBeGreaterThanOrEqual(1);
        expect(reads).toBeLessThanOrEqual(2);
        const initialReads = reads;
        await expect(main.getByRole('button', { name: professional[lang].newClient, exact: true })).toHaveCount(0);
        await expect(main).not.toContainText('PRIVATE');
        state = 'foreign';
        await main.getByRole('button', { name: common[lang].retry, exact: true }).click();
        await expect.poll(() => reads).toBe(initialReads + 1);
        await expect(main.getByRole('alert')).toHaveText(common[lang].dataUnavailableDescription);
        await expect(main).not.toContainText(record.name);
        state = 'ok';
        await main.getByRole('button', { name: common[lang].retry, exact: true }).click();
        await expect(main.getByRole('heading', { name: record.name, exact: true })).toBeVisible();
        expect(reads).toBe(initialReads + 2);
        await expect(main.getByRole('alert')).toHaveCount(0);
        for (const width of [360, 430, 768, 1024, 1440, 1728]) {
            await page.setViewportSize({ width, height: 1000 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        expect(errors).toEqual([]);
    });
test('the ordinary preview keeps its organization fixtures without a private collection request', async ({ page }) => {
    let reads = 0;
    page.on('request', request => { if (request.url().includes('/rpc/read_owned_collection') && request.postDataJSON()?.p_entity === 'organizations')
        reads++; });
    await gotoPreview(page, { lang: 'en' });
    await page.goto('/dev-preview?tab=clients');
    await expect(page.getByRole('heading', { name: organizations[0].name, exact: true })).toBeVisible();
    expect(reads).toBe(0);
});
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: failed cached client refresh keeps records and exposes one retry`, async ({ page }) => {
        let failed = false, reads = 0;
        const p = professional[lang], errors: string[] = [];
        page.on('pageerror', error => errors.push(error.message));
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        await page.route('**/rest/v1/rpc/read_owned_collection', route => { reads++; return failed ? route.fulfill({ status: 503, json: { message: 'PRIVATE TEST' } }) : route.fulfill({ json: [record] }); });
        await page.route('**/rest/v1/organizations**', route => route.fulfill({ json: [] }));
        await page.goto('/dev-preview?tab=clients&organizations=live');
        await page.getByRole('button', { name: `${p.delete}: ${record.name}`, exact: true }).click();
        await page.getByRole('dialog', { name: p.delete, exact: true }).getByRole('button', { name: common[lang].delete, exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toHaveText(p.organizationChanged);
        failed = true;
        await page.getByRole('button', { name: p.organizationReload, exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert').filter({ hasText: p.organizationReadUnavailable })).toBeVisible();
        await expect(page.getByRole('heading', { name: record.name, exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: p.organizationReload, exact: true })).toHaveCount(1);
        await expect(page.getByRole('main')).not.toContainText('PRIVATE');
        for (const width of [360, 430, 768, 1024, 1440, 1728]) {
            await page.setViewportSize({ width, height: 1000 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            if (width < 768) {
                await expect.poll(async () => { const message = await page.getByRole('main').getByRole('alert').filter({ hasText: p.organizationReadUnavailable }).boundingBox(), control = await page.getByRole('button', { name: p.organizationReload, exact: true }).boundingBox(); return !!message && !!control && control.y >= message.y + message.height && Math.abs(control.width - message.width) < 1 && control.height >= 44; }).toBe(true);
            }
        }
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        const before = reads;
        failed = false;
        await page.getByRole('button', { name: p.organizationReload, exact: true }).click();
        await expect(page.getByRole('main').getByRole('alert')).toHaveCount(0);
        expect(reads).toBe(before + 1);
        await expect(page.getByRole('heading', { name: record.name, exact: true })).toBeVisible();
        expect(errors).toEqual([]);
    });
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: long client details wrap and unsupported website schemes stay inert`, async ({ page }) => {
        const p = professional[lang], long = { ...record, name: 'Synthetic organization ' + 'LongName'.repeat(35), notes: 'LongNote'.repeat(100), website: 'data:text/html,SyntheticLegacy' + 'LongAddress'.repeat(30), email: 'synthetic' + 'contact'.repeat(20) + '@example.com', company_id: 'FOREIGN-123ABC' };
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        await page.route('**/rest/v1/rpc/read_owned_collection', route => route.fulfill({ json: [long] }));
        await page.goto('/dev-preview?tab=clients&organizations=live');
        await page.getByRole('button', { name: `${p.showRelationship}: ${long.name}`, exact: true }).click();
        await expect(page.getByRole('main').getByRole('link', { name: long.website, exact: true })).toHaveCount(0);
        await expect(page.getByText(p.aresUnsupported, { exact: true })).toBeVisible();
        for (const width of [360, 430, 768, 1024, 1440, 1728]) {
            await page.setViewportSize({ width, height: 1000 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        }
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
    });
