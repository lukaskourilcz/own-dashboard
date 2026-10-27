import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFileSync } from 'node:fs';
import { gotoPreview, watchConsole } from './helpers';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '../src/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
for (const lang of ['en', 'cs'] as const) {
    test(`${lang}: cached Music refresh has compact keyboard recovery and retained upload`, async ({ page }, info) => {
        const errors = watchConsole(page), t = dneskaiAudio[lang];
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        let failed = false, trendsUnavailable = true, reads = 0, writes = 0, hold = false, release: (() => void) | undefined;
        await page.route('**/api/marketing/dneskai/audio', async (route) => {
            if (route.request().method() !== 'GET') {
                writes++;
                return route.fulfill({ status: 405, json: {} });
            }
            reads++;
            if (hold)
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            return route.fulfill(failed ? { status: 503, json: { error: 'audio-library-unavailable' } } : { json: { tracks: [DEMO_DNESKAI_AUDIO_TRACKS[0]], trends: [], trendsStatus: trendsUnavailable ? 'unavailable' : 'disabled', nextOffset: null } });
        });
        await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music&music=live');
        const music = page.getByTestId('dneskai-audio-library');
        await expect(music.getByTestId('dneskai-audio-track')).toHaveCount(1);
        failed = true;
        await music.getByRole('button', { name: t.trends.retry, exact: true }).click();
        const notice = music.getByTestId('dneskai-audio-read-notice'), retry = notice.getByRole('button', { name: t.retry, exact: true });
        await expect(notice.getByRole('alert')).toHaveText(t.refreshUnavailable);
        await expect(music.getByText(t.empty, { exact: true })).toHaveCount(0);
        await expect(music.getByRole('button', { name: t.upload.title, exact: true })).toBeVisible();
        for (const width of [360, 430, 768, 1024, 1440, 1728]) {
            await page.setViewportSize({ width, height: 1100 });
            await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
            const b = (await retry.boundingBox())!;
            expect(b.height).toBeGreaterThanOrEqual(width < 768 ? 44 : 32);
            if (width === 1440) {
                const n = (await notice.boundingBox())!, p = (await notice.locator('p').boundingBox())!;
                expect(n.width).toBeLessThanOrEqual(p.width + b.width + 10);
            }
        }
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-audio-library"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        if (lang === 'cs') {
            const width = info.project.name === 'mobile' ? 430 : 1440;
            await page.setViewportSize({ width, height: 1200 });
            await music.screenshot({ path: `test-results/audio-read-recovery-cs-${width}.png`, animations: 'disabled' });
            const box = (await music.boundingBox())!, marks = [];
            for (const [index, locator] of [notice, music.getByTestId('dneskai-audio-track')].entries()) {
                const b = (await locator.boundingBox())!;
                marks.push({ n: index + 1, x: 100 * (b.x - box.x) / box.width, y: 100 * (b.y - box.y) / box.height, w: 100 * b.width / box.width, h: 100 * b.height / box.height });
            }
            writeFileSync(`test-results/audio-read-recovery-cs-${width}.json`, JSON.stringify({ viewport: { width, height: 1200 }, box, marks }, null, 2) + '\n');
        }
        await retry.focus();
        const before = reads;
        failed = false;
        trendsUnavailable = false;
        hold = true;
        await page.keyboard.press('Enter');
        await expect.poll(() => reads).toBe(before + 1);
        await expect(retry).toBeDisabled();
        await expect(music.getByTestId('dneskai-audio-track')).toHaveCount(1);
        await expect.poll(() => typeof release).toBe('function');
        hold = false;
        release!();
        await expect(notice).toHaveCount(0);
        expect(writes).toBe(0);
        expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of 503 .*\(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/marketing\/dneskai\/audio(?:\?trackId=[a-f0-9-]+)?\)$/.test(error))).toEqual([]);
    });
    test(`${lang}: saved-track recovery in the actual Lab keeps selection and retries only details`, async ({ page }) => {
        const errors = watchConsole(page), t = dneskaiAudio[lang];
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        let rootEmpty = false, selectedFailed = true, rootReads = 0, selectedReads = 0, writes = 0;
        await page.route('**/api/marketing/dneskai/audio*', async (route) => {
            if (route.request().method() !== 'GET') {
                writes++;
                return route.fulfill({ status: 405, json: {} });
            }
            if (new URL(route.request().url()).searchParams.has('trackId')) {
                selectedReads++;
                return route.fulfill(selectedFailed ? { status: 503, json: { error: 'audio-library-unavailable' } } : { json: { tracks: [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0], enabled: false }], nextOffset: null } });
            }
            rootReads++;
            return route.fulfill({ json: { tracks: rootEmpty ? [] : [DEMO_DNESKAI_AUDIO_TRACKS[0]], trends: [], trendsStatus: rootEmpty ? 'disabled' : 'unavailable', nextOffset: null } });
        });
        await page.goto('/dev-preview?project=dneskai&projectTab=dneskai-review&music=live');
        const lab = page.getByTestId('dneskai-lab');
        await lab.getByTestId('dneskai-format-switch').getByRole('radio', { name: t.format.reel, exact: true }).click();
        const picker = lab.getByTestId('dneskai-audio-picker'), select = picker.getByRole('combobox', { name: t.picker.label, exact: true });
        await select.selectOption(DEMO_DNESKAI_AUDIO_TRACKS[0].id);
        rootEmpty = true;
        await picker.getByRole('button', { name: t.trends.retry, exact: true }).click();
        const notice = picker.getByTestId('dneskai-audio-selected-notice'), retry = notice.getByRole('button', { name: t.selectedRetry, exact: true });
        await expect(notice.getByRole('alert')).toHaveText(t.selectedUnavailable);
        await expect(select).toHaveValue(DEMO_DNESKAI_AUDIO_TRACKS[0].id);
        const beforeRoot = rootReads, beforeSelected = selectedReads;
        selectedFailed = false;
        await retry.focus();
        await page.keyboard.press('Enter');
        await expect(notice).toHaveCount(0);
        await expect(select).toHaveValue(DEMO_DNESKAI_AUDIO_TRACKS[0].id);
        await expect(select.locator('option:checked')).toContainText('Quiet Circuit');
        expect(rootReads).toBe(beforeRoot);
        expect(selectedReads).toBe(beforeSelected + 1);
        expect(writes).toBe(0);
        expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of 503 .*\(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/marketing\/dneskai\/audio(?:\?trackId=[a-f0-9-]+)?\)$/.test(error))).toEqual([]);
    });
}
