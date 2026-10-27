import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '../src/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: refuses repeated page ids and reloads from the beginning`, async ({ page }) => {
        const errors = watchConsole(page), t = dneskaiAudio[lang], reads: string[] = [];
        let fresh = false, writes = 0, hold = false, release: (() => void) | undefined;
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        await page.route('**/api/marketing/dneskai/audio*', async (route) => {
            if (route.request().method() !== 'GET') {
                writes++;
                return route.fulfill({ status: 405, json: {} });
            }
            reads.push(route.request().url());
            if (hold)
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            const later = new URL(route.request().url()).searchParams.has('offset');
            return route.fulfill({
                json: {
                    tracks: [{ ...DEMO_DNESKAI_AUDIO_TRACKS[0], title: later ? 'Unconfirmed replacement' : fresh ? 'Reloaded track' : 'Retained track' }], nextOffset: later || fresh ? null : 1, trends: [], trendsStatus: 'disabled'
                }
            });
        });
        await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music&music=live');
        const library = page.getByTestId('dneskai-audio-library');
        await expect(library.getByTestId('dneskai-audio-track')).toHaveCount(1);
        await library.getByRole('button', { name: t.loadMore, exact: true }).click();
        const notice = library.getByTestId('dneskai-audio-read-notice'), retry = notice.getByRole('button', { name: t.retry, exact: true });
        await expect(notice.getByRole('alert')).toHaveText(t.pagesUnavailable);
        await expect(library.getByTestId('dneskai-audio-track')).toHaveCount(1);
        await expect(library.getByText('Retained track', { exact: false })).toBeVisible();
        await expect(library.getByText('Unconfirmed replacement', { exact: false })).toHaveCount(0);
        await expect(library.getByRole('button', { name: t.loadMore, exact: true })).toHaveCount(0);
        await expect(library.getByRole('button', { name: t.upload.title, exact: true })).toBeVisible();
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-audio-library"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        const before = reads.length;
        fresh = true;
        hold = true;
        await retry.focus();
        await page.keyboard.press('Enter');
        await expect.poll(() => reads.length).toBe(before + 1);
        expect(new URL(reads.at(-1)!).search).toBe('');
        await expect(retry).toBeDisabled();
        await expect(library.getByTestId('dneskai-audio-track')).toHaveCount(1);
        await expect.poll(() => typeof release).toBe('function');
        hold = false;
        release!();
        await expect(notice).toHaveCount(0);
        await expect(library.getByText('Reloaded track', { exact: false })).toBeVisible();
        expect(writes).toBe(0);
        expect(errors).toEqual([]);
    });
