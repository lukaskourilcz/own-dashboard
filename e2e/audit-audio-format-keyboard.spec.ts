import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
test.beforeEach(async ({page}) => {
    await page.addInitScript(() => {
        const original = console.error.bind(console);
        console.error = (...values: unknown[]) => {
            if (typeof values[0] === 'string' && values[0].includes("hasn't mounted yet")) original(...values, new Error('AUDIT_PREMOUNT_CALLER').stack);
            else original(...values);
        };
    });
});
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: format radios use native keyboard selection without moving the Lab slide`, async ({ page }) => {
        const errors = watchConsole(page), t = dneskaiAudio[lang].format, writes: string[] = [];
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        page.on('request', request => {
            if (request.url().includes('/api/marketing/'))
                writes.push(request.url());
        });
        await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review');
        const group = page.getByTestId('dneskai-format-switch'), carousel = group.getByRole('radio', { name: t.carousel, exact: true }), reel = group.getByRole('radio', { name: t.reel, exact: true });
        await carousel.focus();
        await expect(carousel).toBeChecked();
        await page.keyboard.press('ArrowRight');
        await expect(reel).toBeChecked();
        await expect(reel).toBeFocused();
        const url = new URL(page.url());
        expect(url.searchParams.get('labSlide') ?? '0').toBe('0');
        await page.keyboard.press('Tab');
        await expect(carousel).not.toBeFocused();
        await expect(reel).not.toBeFocused();
        await page.keyboard.press('Shift+Tab');
        await expect(reel).toBeFocused();
        await page.keyboard.press('ArrowDown');
        await expect(carousel).toBeChecked();
        await expect(carousel).toBeFocused();
        await page.keyboard.press('ArrowLeft');
        await expect(reel).toBeChecked();
        await expect(reel).toBeFocused();
        await page.keyboard.press('ArrowUp');
        await expect(carousel).toBeChecked();
        for (const width of [360, 430, 768, 1024, 1440, 1728]) {
            await page.setViewportSize({ width, height: 1100 });
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            for (const radio of [carousel, reel]) {
                const box = (await radio.locator('..').boundingBox())!;
                expect(box.height).toBeGreaterThanOrEqual(44);
                expect(box.width).toBeGreaterThanOrEqual(44);
            }
        }
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-format-switch"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        expect(writes).toEqual([]);
        expect(errors).toEqual([]);
    });
