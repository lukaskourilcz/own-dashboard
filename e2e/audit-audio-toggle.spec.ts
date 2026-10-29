import { test, expect } from '@playwright/test';
import {writeFileSync} from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
import { DEMO_DNESKAI_AUDIO_TRACKS } from '../src/lib/marketing/dneskai-audio-client';
import { dneskaiAudio } from '../src/lib/i18n/sections/dneskai-audio';
import { common } from '../src/lib/i18n/sections/common';
import { nav } from '../src/lib/i18n/sections/nav';
const owner='11111111-1111-4111-8111-111111111111';
for (const lang of ['en', 'cs'] as const)
    test(`${lang}: captured music toggle protects pending exits and reconciles uncertainty with a read`, async ({ page },info) => {
        const errors = watchConsole(page), t = dneskaiAudio[lang];
        let track = { ...DEMO_DNESKAI_AUDIO_TRACKS[0] }, writes = 0, reads = 0, release: (() => void) | undefined;
        await gotoPreview(page, { lang, theme: lang === 'cs' ? 'dark' : 'light' });
        await page.route('**/api/marketing/dneskai/audio', async (route) => {
            if (route.request().method() === 'GET') {
                reads++;
                return route.fulfill({ json: { tracks: [track], trends: [], trendsStatus: 'disabled', nextOffset: null } });
            }
            const input = route.request().postDataJSON();
            expect(input).toEqual({ action: 'toggle', ownerId: owner, id: track.id, expectedVersion: track.updatedAt, enabled: !track.enabled });
            writes++;
            if (writes === 1) {
                await new Promise<void>(resolve => {
                    release = resolve;
                });
                track = { ...track, enabled: false, updatedAt: '2026-10-23T08:00:00.000001Z' };
                return route.fulfill({ status: 503, json: { error: 'audio-track-write-failed' } });
            }
            track = { ...track, enabled: input.enabled, updatedAt: '2026-10-23T08:00:00.000002Z' };
            return route.fulfill({ json: { receipt: { kind: 'saved', ownerId: owner, id: track.id, expectedVersion: input.expectedVersion, requestedEnabled: input.enabled, updatedAt: track.updatedAt } } });
        });
        await page.goto('/dev-preview?project=dneskai&projectTab=sources&sourceSection=music&music=live');
        const library = page.getByTestId('dneskai-audio-library'), toggle = library.getByRole('switch', { name: t.enable(track.title), exact: true });
        await expect(toggle).toBeEnabled();
        const initialReads = reads;
        await toggle.click();
        await expect.poll(() => writes).toBe(1);
        await expect(toggle).toBeDisabled();
        await expect(toggle).toBeChecked();
        await toggle.dispatchEvent('click');
        expect(writes).toBe(1);
        await page.getByRole('button', { name: nav[lang].sections.home, exact: true }).first().click();
        const guard = page.getByRole('dialog', { name: common[lang].unsaved.pendingTitle, exact: true });
        await expect(guard).toBeVisible();
        await expect(guard.getByRole('button', { name: common[lang].unsaved.discard, exact: true })).toBeDisabled();
        await guard.getByRole('button', { name: common[lang].unsaved.stay, exact: true }).click();
        await expect.poll(() => typeof release).toBe('function');
        release!();
        await expect(library.getByRole('alert')).toHaveText(t.errors['audio-track-write-failed']);
        await expect(toggle).toBeChecked();
        await expect(toggle).toBeDisabled();
        expect(reads).toBe(initialReads);
        for(const width of [360,430,768,1024,1440,1728]){
            await page.setViewportSize({width,height:1100});
            expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
            const button=library.getByRole('button',{name:t.reloadLibrary,exact:true}),box=(await button.boundingBox())!;
            expect(box.height).toBeGreaterThanOrEqual(width<768?44:32);
        }
        if(lang==='cs'){
            const width=info.project.name==='mobile'?430:1440;await page.setViewportSize({width,height:1200});
            const file=`test-results/audio-toggle-recovery-cs-${width}`;await library.screenshot({path:file+'.png',animations:'disabled'});
            const box=(await library.boundingBox())!,marks=[];
            for(const [index,element] of [toggle,library.getByTestId('dneskai-audio-read-notice')].entries()){
                const rect=(await element.boundingBox())!;marks.push({n:index+1,x:100*(rect.x-box.x)/box.width,y:100*(rect.y-box.y)/box.height,w:100*rect.width/box.width,h:100*rect.height/box.height});
            }
            writeFileSync(file+'.json',JSON.stringify({viewport:{width,height:1200},box,marks},null,2)+'\n');
        }
        const reload = library.getByRole('button', { name: t.reloadLibrary, exact: true });
        await reload.focus();
        await page.keyboard.press('Enter');
        await expect(toggle).not.toBeChecked();
        await expect(toggle).toBeEnabled();
        await expect(toggle).toBeFocused();
        expect(writes).toBe(1);
        expect(reads).toBe(initialReads + 1);
        const before = reads;
        await toggle.press('Space');
        await expect(toggle).toBeChecked();
        await expect(toggle).toBeEnabled();
        expect(writes).toBe(2);
        expect(reads).toBe(before);
        await expect(library.getByRole('alert')).toHaveCount(0);
        expect((await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('[data-testid="dneskai-audio-library"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of 503 .*\(http:\/\/(?:localhost|127\.0\.0\.1):\d+\/api\/marketing\/dneskai\/audio\)$/.test(error))).toEqual([]);
    });
