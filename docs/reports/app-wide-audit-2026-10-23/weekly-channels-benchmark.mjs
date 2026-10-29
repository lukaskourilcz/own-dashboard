/** Local synthetic CPU and exact aggregate parity; no backend/provider/environment reads. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('../../../', import.meta.url)), baselineCommit = 'ae0eecc';
const candidateSource = readFileSync(`${root}src/lib/weekly-planning.ts`, 'utf8');
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:src/lib/weekly-planning.ts`], { cwd: root, encoding: 'utf8' });
async function load(contents) {
  const result = await build({ stdin: { contents, resolveDir: root, sourcefile: 'src/lib/weekly-planning.ts', loader: 'ts' },
    bundle: true, write: false, platform: 'node', format: 'esm', tsconfig: `${root}tsconfig.json`, logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString('base64')}`);
}
const baseline = await load(baselineSource), candidate = await load(candidateSource);
const refs = Object.freeze({
  organizations: Object.freeze(Array.from({ length: 25 }, (_, index) => Object.freeze({ name: `Klient ${index} s.r.o.`, type: index % 5 ? 'client' : 'employer' }))),
  projects: Object.freeze(Array.from({ length: 100 }, (_, index) => Object.freeze({ name: `Příprava ${index}`, slug: `priprava-${index}`,
    previous_slugs: Object.freeze([`old-${index}`]), engagement: index % 3 ? 'own' : 'client', organization_id: index % 3 ? null : `fixture-org-${index}` }))),
});
const events = Object.freeze(Array.from({ length: 1000 }, (_, index) => Object.freeze({
  id: `fixture-${index}`, summary: index % 5 === 0 ? `Call with Klient ${index % 25}` : index % 5 === 1 ? 'Bookkeeping' : index % 5 === 2 ? `Old-${index % 100} release` : `PŘÍPRAVA ${index % 100} delivery`,
  start: Object.freeze(index % 13 ? { dateTime: `2026-10-${String(19 + index % 7).padStart(2, '0')}T09:00:00Z` } : { date: '2026-10-20' }),
  end: Object.freeze(index % 13 ? { dateTime: `2026-10-${String(19 + index % 7).padStart(2, '0')}T${index % 43 ? '10' : '09'}:00:00Z` } : { date: '2026-10-21' }),
})));
const range = { start: new Date('2026-10-19T00:00:00Z'), endExclusive: new Date('2026-10-26T00:00:00Z') };
const summarize = module => module.summarizeTimeByChannel(events, refs, range);
deepStrictEqual(summarize(candidate), summarize(baseline));
const warmups = 3, iterations = 21, samples = { baseline: [], candidate: [] };
for (let i = 0; i < warmups; i++) { summarize(baseline); summarize(candidate); }
for (let i = 0; i < iterations; i++) for (const kind of i % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
  const start = performance.now(); summarize(kind === 'baseline' ? baseline : candidate); samples[kind].push(performance.now() - start);
}
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const before = median(samples.baseline), after = median(samples.candidate);
const result = { measuredAt: new Date().toISOString(), node: process.version, baselineCommit,
  candidateParentCommit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  candidateSourceSha256: createHash('sha256').update(candidateSource).digest('hex'),
  fixture: { events: events.length, projects: refs.projects.length, organizations: refs.organizations.length, warmups, iterations,
    description: 'Invented mixed named/unnamed work, legal forms, diacritics, old slugs, all-day and zero-length entries. No own-project organization links, so the separately tested classification correction does not change benchmark results.',
    parity: 'Exact complete aggregate equality before timing; frozen input records.', order: 'Alternating baseline/candidate per sample' },
  scope: 'Local synthetic CPU only. Does not measure production latency, network, database or financial savings.',
  baselineMedianMs: before, candidateMedianMs: after, percentChange: (after / before - 1) * 100, samplesMs: samples };
writeFileSync(new URL('weekly-channels-cpu.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ baselineMedianMs: before, candidateMedianMs: after, percentChange: result.percentChange }));
