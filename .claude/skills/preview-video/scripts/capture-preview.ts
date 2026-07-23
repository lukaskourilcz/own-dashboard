/**
 * Animated scroll preview capture (Refero-style).
 * Run from repo root: npx -y tsx .claude/skills/preview-video/scripts/capture-preview.ts
 * Reads ../preview.config.json, writes media/preview.{webm,mp4} + media/preview-poster.png
 *
 * Optional environment overrides (all no-ops when unset, so the default
 * behaviour is a plain local capture):
 *   CAPTURE_PROXY_SERVER  route the browser through an HTTP proxy (e.g. a
 *                         corporate proxy or a local TLS-terminating bridge)
 *   CAPTURE_INSECURE=1    ignore TLS certificate errors (only meaningful when
 *                         a MITM proxy above re-signs certificates)
 *   CAPTURE_EXTRA_ARGS    extra Chromium args, comma-separated
 */
import { chromium } from 'playwright';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(readFileSync(join(here, '..', 'preview.config.json'), 'utf8'));

const {
  url,
  devServer = null,          // { command: "npm run dev", port: 3000 } | null
  viewport = { width: 1280, height: 800 },
  deviceScaleFactor = 2,
  fps = 30,
  scrollSeconds = 'auto',    // 'auto' => ~350 px/s, clamped to 4–12 s
  holdFrames = 20,           // still frames on hero and on footer
  scrollSelector = null,     // CSS selector of an inner scroll container (fixed-shell SPAs); null => window
  hideSelectors = [],
  extraCss = '',
  waitAfterLoadMs = 800,
  gif = false,
} = cfg;

// --- optional dev server ---------------------------------------------------
let server: ChildProcess | null = null;
async function waitForServer(target: string, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(target);
      if (r.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Dev server not reachable at ${target}`);
}
if (devServer) {
  server = spawn(devServer.command, { shell: true, stdio: 'inherit' });
  await waitForServer(url);
}

// --- capture ---------------------------------------------------------------
const frameDir = mkdtempSync(join(tmpdir(), 'preview-frames-'));
mkdirSync('media', { recursive: true });

const insecure = process.env.CAPTURE_INSECURE === '1';
const launchArgs = ['--disable-quic'];
if (typeof process.getuid === 'function' && process.getuid() === 0) {
  launchArgs.push('--no-sandbox'); // Chromium refuses to run as root without this
}
if (insecure) launchArgs.push('--ignore-certificate-errors');
if (process.env.CAPTURE_EXTRA_ARGS) launchArgs.push(...process.env.CAPTURE_EXTRA_ARGS.split(','));

const browser = await chromium.launch({
  args: launchArgs,
  ...(process.env.CAPTURE_PROXY_SERVER
    ? { proxy: { server: process.env.CAPTURE_PROXY_SERVER } }
    : {}),
});
const page = await browser.newPage({ viewport, deviceScaleFactor, ignoreHTTPSErrors: insecure });
try {
  await page.goto(url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => (document as any).fonts?.ready);
  const hideCss = hideSelectors.length
    ? `${hideSelectors.join(', ')} { display: none !important; }`
    : '';
  await page.addStyleTag({
    content: `
      html { scroll-behavior: auto !important; }
      ::-webkit-scrollbar { display: none !important; }
      ${hideCss}
      ${extraCss}
    `,
  });
  // Pre-scroll the whole page to trigger lazy-loading, then return to top.
  // Scrolls an inner container when `scrollSelector` is set (fixed-shell SPAs),
  // otherwise the window — identical to the original behaviour.
  await page.evaluate(async (sel: string | null) => {
    const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    for (let y = 0; y <= (el ? el.scrollHeight : document.body.scrollHeight); y += 600) {
      if (el) el.scrollTop = y;
      else scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 80));
    }
    if (el) el.scrollTop = 0;
    else scrollTo(0, 0);
  }, scrollSelector);
  await page.waitForTimeout(waitAfterLoadMs);

  const total = await page.evaluate((sel: string | null) => {
    const el = sel ? (document.querySelector(sel) as HTMLElement | null) : null;
    if (el) return el.scrollHeight - el.clientHeight;
    return (
      Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) -
      innerHeight
    );
  }, scrollSelector);
  const seconds =
    scrollSeconds === 'auto' ? Math.min(12, Math.max(4, total / 350)) : scrollSeconds;
  const frames = Math.round(fps * seconds);
  const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  let i = 0;
  const shot = () =>
    page.screenshot({ path: join(frameDir, `${String(i++).padStart(4, '0')}.png`) });

  for (let k = 0; k < holdFrames; k++) await shot(); // hold on hero
  for (let f = 0; f <= frames; f++) {
    const y = Math.round(ease(f / frames) * total);
    await page.evaluate(
      (args: [number, string | null]) => {
        const el = args[1] ? (document.querySelector(args[1]) as HTMLElement | null) : null;
        if (el) el.scrollTop = args[0];
        else scrollTo(0, args[0]);
      },
      [y, scrollSelector] as [number, string | null],
    );
    await page.waitForTimeout(10);
    await shot();
  }
  for (let k = 0; k < holdFrames; k++) await shot(); // hold on footer
  console.log(`Captured ${i} frames — ${seconds.toFixed(1)}s scroll over ${total}px`);
} finally {
  await browser.close();
  server?.kill('SIGTERM');
}

// --- encode ----------------------------------------------------------------
const input = `-framerate ${fps} -i ${join(frameDir, '%04d.png')} -vf scale=${viewport.width}:-2`;
execSync(
  `ffmpeg -y ${input} -c:v libvpx-vp9 -b:v 0 -crf 34 -pix_fmt yuv420p media/preview.webm`,
  { stdio: 'inherit' },
);
execSync(
  `ffmpeg -y ${input} -c:v libx264 -crf 23 -preset slow -pix_fmt yuv420p -movflags +faststart media/preview.mp4`,
  { stdio: 'inherit' },
);
execSync(
  `ffmpeg -y -i ${join(frameDir, '0000.png')} -vf scale=${viewport.width}:-2 media/preview-poster.png`,
  { stdio: 'inherit' },
);
if (gif) {
  execSync(
    `ffmpeg -y -i media/preview.mp4 -vf "fps=12,scale=640:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse" media/preview.gif`,
    { stdio: 'inherit' },
  );
}
console.log(`Done. Frames kept for QA at: ${frameDir}`);
