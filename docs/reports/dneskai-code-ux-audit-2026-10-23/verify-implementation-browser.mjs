import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const root = dirname(fileURLToPath(import.meta.url));
const proof = resolve(root, 'implementation-page-proof');
mkdirSync(proof, { recursive: true });
const browser = await chromium.launch();
try {
  for (const [width, colorScheme] of [[1440, 'dark'], [360, 'light']]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    await page.goto(process.argv[2] ?? 'http://127.0.0.1:3943/implementation.html');
    await page.locator('img').evaluateAll(images => images.forEach(image => { image.loading = 'eager'; }));
    await page.waitForFunction(() => Array.from(document.images).every(image => image.complete && image.naturalWidth > 0));
    assert.equal(await page.locator('img').count(), 36);
    assert.equal(await page.locator('h1').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const scan = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    assert.deepEqual(scan.violations.map(violation => ({ id: violation.id, nodes: violation.nodes.map(node => node.target) })), []);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(proof, `report-${width}-${colorScheme}.png`) });
    await page.getByRole('navigation').getByRole('link', { name: 'Sources', exact: true }).click();
    await page.locator('#area-4').waitFor({ state: 'visible' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    console.log(`${width}px ${colorScheme}: 36 images loaded; no asset errors, overflow or axe violations; comparison navigation passed.`);
    await context.close();
  }
} finally { await browser.close(); }
