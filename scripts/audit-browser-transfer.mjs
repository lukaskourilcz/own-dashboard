/** Cold-context public-surface measurements; no owner session or live backend.
 * Run against one optimized local build before and after an implementation. */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const [baseArg = 'http://localhost:3944', output, label = 'local optimized build'] = process.argv.slice(2);
const base = new URL(baseArg);
if (!['localhost', '127.0.0.1', '[::1]'].includes(base.hostname) || !output) throw new Error('Use a local build URL and an output file.');
const browser = await chromium.launch();
const measurements = [];
try {
  for (const route of ['/guest', '/login']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'en-US', reducedMotion: 'reduce' });
    const page = await context.newPage();
    let blockedRemoteRequests = 0;
    await page.route('**/*', request => {
      if (new URL(request.request().url()).origin === base.origin) return request.continue();
      blockedRemoteRequests++;
      return request.fulfill({ status: 503, contentType: 'application/json', body: '{}' });
    });
    await page.addInitScript(() => { localStorage.setItem('lang', 'en'); localStorage.setItem('theme', 'light'); });
    const analyses = [], analyticsSDKChunks = [];
    page.on('response', response => {
      const url = new URL(response.url());
      if (url.origin !== base.origin || !url.pathname.endsWith('.js')) return;
      analyses.push(response.body().then(body => {
        if (body.includes(Buffer.from('__PosthogExtensions__'))) analyticsSDKChunks.push(url.pathname);
      }));
    });
    const response = await page.goto(new URL(route, base).href);
    if (!response?.ok()) throw new Error(`Public route unavailable: ${route}`);
    await page.locator('main').first().waitFor();
    await page.waitForLoadState('networkidle', { timeout: 15000 });
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => new URL(entry.name).pathname.endsWith('.js'))
      .map(entry => ({ path: new URL(entry.name).pathname, initiator: entry.initiatorType,
        encodedBytes: entry.encodedBodySize, decodedBytes: entry.decodedBodySize, transferBytes: entry.transferSize })));
    await Promise.all(analyses);
    measurements.push({ route, scripts, encodedBytes: scripts.reduce((sum, item) => sum + item.encodedBytes, 0),
      decodedBytes: scripts.reduce((sum, item) => sum + item.decodedBytes, 0), analyticsSDKChunks, blockedRemoteRequests });
    await context.close();
  }
  const result = { measuredAt: new Date().toISOString(), label, browser: browser.version(), viewport: '1440x900',
    buildId: (await readFile('.next/BUILD_ID', 'utf8')).trim(), next: JSON.parse(await readFile('node_modules/next/package.json', 'utf8')).version,
    method: 'Fresh browser context per route; EN/light/reduced motion; network idle; all nonlocal requests blocked. Encoded script-body bytes exclude response headers. Public tour and login, not an authenticated owner session.', measurements };
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(measurements.map(({ route, encodedBytes, decodedBytes, analyticsSDKChunks }) => ({ route, encodedBytes, decodedBytes, analyticsSDKChunks }))));
} finally { await browser.close(); }
