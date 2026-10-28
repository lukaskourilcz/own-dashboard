import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const libvipsInclude = './node_modules/@img/sharp-libvips-*/lib/**/*';
async function configuredIncludes(name: 'outputFileTracingIncludes' | 'outputFileTracingExcludes' = 'outputFileTracingIncludes') {
  // Inspect config syntax only; never evaluate its environment/Sentry branches.
  const source = ts.createSourceFile('next.config.ts', await readFile('next.config.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  let object: ts.ObjectLiteralExpression | undefined;
  const constants = new Map<string, ts.Expression>();
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === name && ts.isObjectLiteralExpression(node.initializer)) object = node.initializer;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) constants.set(node.name.text, node.initializer);
    ts.forEachChild(node, visit);
  }
  visit(source);
  // String literals, arrays of them, and the named constants and spreads the config builds them from.
  const strings = (node: ts.Expression): string[] => ts.isStringLiteral(node) ? [node.text]
    : ts.isIdentifier(node) && constants.has(node.text) ? strings(constants.get(node.text)!)
    : ts.isArrayLiteralExpression(node) ? node.elements.flatMap(element => strings(ts.isSpreadElement(element) ? element.expression : element)) : [];
  const includes: Record<string, string[]> = {};
  for (const property of object?.properties ?? []) {
    if (!ts.isPropertyAssignment(property) || !ts.isStringLiteral(property.name)) continue;
    includes[property.name.text] = strings(property.initializer);
  }
  return includes;
}
const picomatch = createRequire(path.resolve('package.json'))('next/dist/compiled/picomatch') as (glob: string, options: { dot: boolean; contains: boolean }) => (value: string) => boolean;
/** What Next adds to one route's trace: the includes of every key whose glob matches the route (next/dist/build/collect-build-traces.js). */
function routeIncludes(includes: Record<string, string[]>, route: string) {
  return Object.entries(includes).filter(([glob]) => picomatch(glob, { dot: true, contains: true })(route)).flatMap(([, patterns]) => patterns);
}
const graph = new Map<string, { sharp: boolean; files: string[] }>();
/** The runtime imports of one project module: static and re-exports without `type`, plus `import()` calls. */
function moduleImports(file: string) {
  const known = graph.get(file);
  if (known) return known;
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) specifiers.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  const files = specifiers.flatMap((specifier) => {
    const base = specifier.startsWith('@/') ? path.resolve('src', specifier.slice(2)) : specifier.startsWith('.') ? path.resolve(path.dirname(file), specifier) : null;
    const found = base && [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`].find((candidate) => /\.tsx?$/.test(candidate) && existsSync(candidate));
    return found ? [found] : [];
  });
  const entry = { sharp: specifiers.includes('sharp'), files };
  graph.set(file, entry);
  return entry;
}
function reachesSharp(file: string) {
  const seen = new Set([file]), queue = [file];
  for (let next = queue.shift(); next; next = queue.shift()) {
    const entry = moduleImports(next);
    if (entry.sharp) return true;
    for (const imported of entry.files) if (!seen.has(imported)) { seen.add(imported); queue.push(imported); }
  }
  return false;
}
/** Every App Router route handler, as the route path Next matches include globs against. */
function routeHandlers() {
  const app = path.resolve('src/app');
  return (readdirSync(app, { recursive: true }) as string[]).filter((file) => /(^|[\\/])route\.tsx?$/.test(file)).map((file) => ({
    file: path.join(app, file),
    route: `/${path.dirname(file).split(path.sep).filter((segment) => segment !== '.' && !segment.startsWith('(') && !segment.startsWith('@')).join('/')}`,
  }));
}
function probeResult(result: Pick<SpawnSyncReturns<string>, 'status' | 'signal' | 'error' | 'stdout'>, missingLibraryExpected = false) {
  // A native loader may terminate instead of throwing JS. Only the negative probe may normalize that.
  expect(result.error).toBeUndefined();
  if (missingLibraryExpected && (result.status !== 0 || result.signal !== null)) return { loaded: false };
  expect(result.status).toBe(0); expect(result.signal).toBeNull();
  return JSON.parse(result.stdout) as { loaded: boolean; cjsCallable?: boolean; esmCallable?: boolean; format?: string; width?: number; height?: number };
}
function probe(directory: string, missingLibraryExpected = false) {
  // Both official exports must load; encode an actual 1px JPEG without inherited keys, hooks or network.
  const script = `(async()=>{try{const cjs=require("sharp"),esm=(await import("sharp")).default;if(typeof cjs!=="function"||typeof esm!=="function")return console.log(JSON.stringify({loaded:false}));const bytes=await esm({create:{width:1,height:1,channels:3,background:{r:0,g:0,b:0}}}).jpeg().toBuffer();const info=await esm(bytes).metadata();console.log(JSON.stringify({loaded:true,cjsCallable:true,esmCallable:true,format:info.format,width:info.width,height:info.height}));}catch{console.log(JSON.stringify({loaded:false}));}})();`;
  const result = spawnSync(process.execPath, ['-e', script], { cwd: directory, env: { PATH: process.env.PATH, NODE_ENV: 'test' }, encoding: 'utf8', timeout: 10000 });
  return probeResult(result, missingLibraryExpected);
}
describe('marketing native JPEG runtime package closure, no provider/source/credential access', () => {
  it('normalizes only negative native exits/signals; positive probes and failed spawning stay strict', () => {
    for (const failure of [{ status: 1, signal: null }, { status: null, signal: 'SIGABRT' as const }]) {
      const result = { ...failure, stdout: 'TEST-ONLY-NATIVE-ERROR-NOT-PARSED' };
      expect(probeResult(result, true)).toEqual({ loaded: false });
      expect(() => probeResult(result)).toThrow();
    }
    expect(() => probeResult({ status: null, signal: null, stdout: '', error: new Error('TEST-ONLY-SPAWN-FAILED') }, true)).toThrow();
  });
  it('traces libvips into every route handler that can load sharp, and into any marketing route added later', async () => {
    const includes = await configuredIncludes();
    expect(includes['/api/marketing/**']).toContain(libvipsInclude);
    const routes = routeHandlers().filter(({ file }) => reachesSharp(file)).map(({ route }) => route);
    expect(routes).toEqual(expect.arrayContaining(['/api/marketing/dneskai/media', '/api/marketing/jobs/[id]/execute', '/api/marketing/n8n', '/api/marketing/offline-import', '/api/marketing/revisions', '/api/marketing/tick']));
    expect(routes.filter((route) => !routeIncludes(includes, route).includes(libvipsInclude))).toEqual([]);
  });
  it('requires the libvips runtime assets omitted by the observed NFT', async () => {
    const temporary = await mkdtemp(path.join(os.tmpdir(), 'marketing-native-package-test-'));
    try {
      const installed = path.resolve('node_modules'), target = path.join(temporary, 'node_modules');
      await mkdir(target);
      for (const name of ['sharp', 'detect-libc']) await cp(path.join(installed, name), path.join(target, name), { recursive: true });
      const imagePackages = await readdir(path.join(installed, '@img'));
      const binaries: { root: string; name: string; binary: string }[] = [];
      for (const name of imagePackages.filter(value => value === 'colour' || value.startsWith('sharp-'))) {
        const root = path.join(installed, '@img', name);
        if (name.startsWith('sharp-libvips-')) {
          const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
          const binary: unknown = manifest.exports?.['./binary'];
          expect(typeof binary).toBe('string');
          if (typeof binary !== 'string') throw new Error('test-native-package-contract-invalid');
          binaries.push({ root, name, binary });
          // Reproduce the observed tracing omission, keeping public package metadata/support files.
          await cp(root, path.join(target, '@img', name), { recursive: true, filter: source => source !== path.resolve(root, binary) });
        } else await cp(root, path.join(target, '@img', name), { recursive: true });
      }
      expect(binaries.length).toBeGreaterThan(0);
      expect(probe(temporary, true)).toEqual({ loaded: false });
      // Materialize the configured, platform-neutral library-directory include.
      for (const entry of binaries) await cp(path.join(entry.root, 'lib'), path.join(target, '@img', entry.name, 'lib'), { recursive: true });
      expect(probe(temporary)).toEqual({ loaded: true, cjsCallable: true, esmCallable: true, format: 'jpeg', width: 1, height: 1 });
    } finally { await rm(temporary, { recursive: true, force: true }); }
  }, 20000);
});


const ignoredRuntimeInputs = ['test-results/fixture/trace.zip', 'playwright-report/data/fixture.png', 'blob-report/fixture.zip', 'coverage/fixture.json', 'playwright/.cache/fixture'];
it('excludes local QA outputs from current and future marketing packages', async () => {
 const exclusions = await configuredIncludes('outputFileTracingExcludes');
 for (const route of [...routeHandlers().filter(({ file, route }) => route.startsWith('/api/marketing/') && reachesSharp(file)).map(({ route }) => route), '/api/marketing/future-render']) {
  const patterns = routeIncludes(exclusions, route);
  const excluded = (file: string) => patterns.some(pattern => picomatch(path.resolve(pattern), { dot: true, contains: true })(path.resolve(file)));
  for (const file of ignoredRuntimeInputs) expect(excluded(file), `${route} must exclude ${file}`).toBe(true);
  for (const file of ['vendor/carousel-studio/fonts/fixture.ttf', 'node_modules/@img/sharp-libvips-darwin-arm64/lib/libvips-cpp.8.18.7.dylib', 'node_modules/ffmpeg-static/ffmpeg', 'templates/marketing/fonts/fixture.ttf', 'node_modules/@sentry/nextjs/build/cjs/server/index.js', 'node_modules/next/dist/compiled/@swc/helpers/cjs/_async_to_generator.cjs']) expect(excluded(file), `${route} must retain runtime ${file}`).toBe(false);
 }
});
