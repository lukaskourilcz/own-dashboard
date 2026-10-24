/** Local synthetic CPU comparison; no database, provider or environment reads. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { deepStrictEqual } from 'node:assert';
import { transform } from 'esbuild';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const baselineCommit = 'eb31eca';
const baselineSource = execFileSync('git', ['show', `${baselineCommit}:src/lib/portfolio.ts`], { cwd: root, encoding: 'utf8' });
const candidateSource = readFileSync(`${root}src/lib/portfolio.ts`, 'utf8');
async function load(source) {
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const baseline = await load(baselineSource), candidate = await load(candidateSource);
const count = 5000, warmups = 5, iterations = 31;
const rows = Object.freeze(Array.from({ length: count }, (_, index) => {
  const entry = candidate.PORTFOLIO[index];
  const parent = entry?.parentKey ? candidate.PORTFOLIO.findIndex(row => row.key === entry.parentKey) : -1;
  return Object.freeze({ id: `fixture-${index}`, user_id: 'fixture-owner', name: `Fixture ${index}`, slug: `fixture-${index}`,
    repo_full_name: entry?.repo ?? `fixture/project-${index}`, previous_repo_full_names: Object.freeze([]), portfolio_key: entry?.key ?? null,
    parent_id: parent >= 0 ? `fixture-${parent}` : null, summary: '', notes: '', url: null, color: null,
    sort_order: (index * 7919) % count, is_active: true, created_at: '2026-10-24T09:00:00Z', updated_at: '2026-10-24T09:00:00Z' });
}));
const operations = ['groupPortfolio', 'planPortfolioSync'];
const measurements = {};
for (const name of operations) {
  deepStrictEqual(candidate[name](rows), baseline[name](rows));
  for (let n = 0; n < warmups; n++) { baseline[name](rows); candidate[name](rows); }
  const samples = { baseline: [], candidate: [] };
  for (let n = 0; n < iterations; n++) {
    for (const kind of n % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
      const start = performance.now(); (kind === 'baseline' ? baseline : candidate)[name](rows); samples[kind].push(performance.now() - start);
    }
  }
  const median = list => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
  const before = median(samples.baseline), after = median(samples.candidate);
  measurements[name] = { baselineMedianMs: before, candidateMedianMs: after, percentChange: (after / before - 1) * 100, samplesMs: samples };
}
const result = { measuredAt: new Date().toISOString(), node: process.version, baselineCommit,
  candidateParentCommit: execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  candidateSourceSha256: createHash('sha256').update(candidateSource).digest('hex'),
  fixture: { rows: count, description: 'Seven keyed registry projects and otherwise unregistered owned projects; unique sort positions, complete child parents, no identity conflicts.', warmups, iterations, order: 'Alternating baseline/candidate per sample', parity: 'Exact grouped records and no-op plans match before timing.' },
  scope: 'Local synthetic CPU only. Does not measure production latency, network, database work or financial savings.', measurements };
writeFileSync(new URL('portfolio-identity-cpu.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(Object.fromEntries(Object.entries(measurements).map(([name, value]) => [name, { baselineMedianMs: value.baselineMedianMs, candidateMedianMs: value.candidateMedianMs, percentChange: value.percentChange }]))));
