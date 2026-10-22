#!/usr/bin/env node
/**
 * Smoke test of `next build` output for the marketing routes that render or inspect images (#117).
 *
 *   npm run build && npm run check:render-traces
 *
 * Reads each route's `.next/server/app/<route>/route.js.nft.json`, the list of files Vercel copies into
 * that function, and fails unless it holds the three things sharp and the vendored studio need at run time:
 *
 * - libvips: `libvips-cpp.so*` from the root `node_modules/@img/sharp-libvips-<platform>/lib`, for the same
 *   platform as the addon. The default trace keeps the addon and drops this library, and sharp then fails
 *   to load (docs/marketing-render-preflight.md). The `.so` name means the check expects a Linux build, as
 *   on CI and Vercel.
 * - at least one vendored studio font under `vendor/carousel-studio/fonts/`. Without one the rasteriser
 *   has no face to draw with, because system fonts are switched off.
 * - sharp's native addon, `node_modules/@img/sharp-<platform>/lib/sharp-<platform>-<version>.node`.
 *
 * Copies inside other packages (next ships its own sharp) do not count. Every matched file must also
 * exist on disk. Plain Node, no dependencies, no network.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appDirectory = path.join(root, '.next/server/app');

/**
 * The route handlers that render or inspect images. More marketing handlers reach sharp through their imports;
 * tests/lib/marketing-render-packaging.test.ts guards the shared `/api/marketing/**` include that covers them all.
 */
const routes = [
  '/api/marketing/tick',
  '/api/marketing/revisions',
  '/api/marketing/jobs/[id]/execute',
  '/api/marketing/dneskai/media',
  '/api/marketing/n8n',
  '/api/marketing/offline-import',
  '/api/marketing/dneskai/render-reel',
  '/api/marketing/dneskai/audio',
];
/** Routes that also run the ffmpeg-static binary (#163): its executable must be in the function. */
const ffmpegRoutes = new Set(['/api/marketing/dneskai/render-reel', '/api/marketing/dneskai/audio']);
const ffmpegFile = 'node_modules/ffmpeg-static/ffmpeg';

const addonPattern = /^node_modules\/@img\/sharp-([^/]+)\/lib\/sharp-\1-[^/]+\.node$/;
const libvipsPattern = /^node_modules\/@img\/sharp-libvips-([^/]+)\/lib\/libvips-cpp\.so(\.\d+)*$/;
const fontPattern = /^vendor\/carousel-studio\/fonts\/.+\.(ttf|otf|woff2?)$/;

/** One route's verdict: the problems found, and what was matched for the summary line. */
function checkRoute(route) {
  const tracePath = path.join(appDirectory, route, 'route.js.nft.json');
  const traceName = path.relative(root, tracePath);
  if (!existsSync(tracePath)) return { problems: [`no trace at ${traceName}; run npm run build first`] };
  let trace;
  try {
    trace = JSON.parse(readFileSync(tracePath, 'utf8'));
  } catch (error) {
    return { problems: [`${traceName} is not JSON: ${error.message}`] };
  }
  if (!Array.isArray(trace?.files)) return { problems: [`${traceName} has no files array`] };

  // Trace entries are relative to the trace file; compare them as project-relative POSIX paths.
  const files = trace.files.map((file) => path.relative(root, path.resolve(path.dirname(tracePath), file)).split(path.sep).join('/'));
  const missingOnDisk = (file) => !existsSync(path.join(root, file));
  const problems = [];

  const addons = files.filter((file) => addonPattern.test(file));
  const addonPlatforms = new Set(addons.map((file) => addonPattern.exec(file)[1]));
  if (addons.length === 0) problems.push('no sharp native addon (node_modules/@img/sharp-<platform>/lib/sharp-<platform>-<version>.node)');

  const libvips = files.filter((file) => libvipsPattern.test(file));
  const matchingLibvips = libvips.filter((file) => addonPlatforms.size === 0 || addonPlatforms.has(libvipsPattern.exec(file)[1]));
  if (libvips.length === 0) problems.push('no libvips-cpp.so under node_modules/@img/sharp-libvips-<platform>/lib (is "./node_modules/@img/sharp-libvips-*/lib/**/*" still in outputFileTracingIncludes?)');
  else if (matchingLibvips.length === 0) problems.push(`libvips is traced for ${libvips.map((file) => libvipsPattern.exec(file)[1]).join(', ')} but the addon is for ${[...addonPlatforms].join(', ')}`);

  const fonts = files.filter((file) => fontPattern.test(file));
  if (fonts.length === 0) problems.push('no vendored studio font under vendor/carousel-studio/fonts/ (is "./vendor/carousel-studio/fonts/**/*" still in outputFileTracingIncludes?)');

  const ffmpeg = ffmpegRoutes.has(route) ? files.filter((file) => file === ffmpegFile) : [];
  if (ffmpegRoutes.has(route) && ffmpeg.length === 0) problems.push(`no ${ffmpegFile} (is "./node_modules/ffmpeg-static/ffmpeg" still in outputFileTracingIncludes?)`);

  for (const file of [...addons, ...matchingLibvips, ...fonts, ...ffmpeg].filter(missingOnDisk)) problems.push(`listed but missing on disk: ${file}`);

  return { problems, files: files.length, addon: addons[0], libvips: matchingLibvips[0], fonts: fonts.length };
}

let failed = 0;
for (const route of routes) {
  const result = checkRoute(route);
  if (result.problems.length > 0) {
    failed += 1;
    for (const problem of result.problems) console.error(`FAIL ${route}: ${problem}`);
    continue;
  }
  console.log(`ok   ${route}: ${path.basename(result.libvips)}, ${path.basename(result.addon)}, ${result.fonts} studio fonts, ${result.files} files`);
}

if (failed > 0) {
  console.error(`check-render-traces: ${failed} of ${routes.length} marketing routes would deploy without what sharp or the studio needs. See docs/marketing-render-preflight.md.`);
  process.exit(1);
}
console.log(`check-render-traces: all ${routes.length} marketing render routes trace libvips, the sharp addon and the studio fonts.`);
