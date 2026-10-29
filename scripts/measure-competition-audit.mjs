/** Offline source-expression probe. Synthetic records only; no provider,
 * environment-file or database access. Includes index construction in samples. */
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { buildSync } from 'esbuild';
import ts from 'typescript';
const require = createRequire(import.meta.url), root = process.cwd(), baseline = '1002cc1', path = 'src/components/panels/competition-panel.tsx';
const before = execFileSync('git', ['show', `${baseline}:${path}`], { encoding: 'utf8' }), after = readFileSync(path, 'utf8');
function initializer(source, name) {
 const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX); let found;
 function visit(node) { if (ts.isVariableDeclaration(node) && node.name.getText(file) === name) found = node.initializer; ts.forEachChild(node, visit); } visit(file);
 if (!found) throw Error(`Missing actual expression ${name}`);
 return { text: found.getText(file), memo: ts.isCallExpression(found) ? found.arguments[0].getText(file) : null };
}
const normalization = initializer(before, 'searchable').text;
const code = `import {childProjects,groupPortfolio,isPortfolioProject} from './src/lib/portfolio';
import {projectEngagement} from './src/lib/projects';
import {competitionProjectOrder,isCompetitorReviewStale} from './src/lib/competition';
const searchable=${normalization};
export function beforeOrder(projects,competitors){return (${initializer(before, 'orderedProjects').memo})();}
export const afterOrder=competitionProjectOrder;
export function beforeFilter(competitors,query){const projectFilter='all',categoryFilter='all',reviewFilter='all',now=null;return (${initializer(before, 'visible').memo})();}
export function makeIndex(competitors){const searching=true;return (${initializer(after, 'searchIndex').memo})();}
export function afterFilter(competitors,searchIndex,query){const projectFilter='all',categoryFilter='all',reviewFilter='all',now=null;return (${initializer(after, 'visible').memo})();}`;
const bundled = buildSync({ stdin: { contents: code, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'cjs', platform: 'node', target: 'node22', tsconfig: 'tsconfig.json', logLevel: 'silent' }).outputFiles[0].text;
const compiledModule = { exports: {} }; new Function('require', 'module', 'exports', bundled)(require, compiledModule, compiledModule.exports); const implementation = compiledModule.exports;
const projects = Array.from({ length: 5000 }, (_, index) => ({ id: `p${index}`, name: `Synthetic ${index}`, user_id: 'synthetic', parent_id: index >= 4000 ? `p${index - 4000}` : null, repo_full_name: index === 0 ? 'lukaskourilcz/own-dashboard' : null, portfolio_key: index === 0 ? 'own-dashboard' : null, previous_repo_full_names: [], engagement: index % 5 ? 'client' : 'own', is_active: index % 9 !== 0, sort_order: index % 100, created_at: '2026-10-25T00:00:00Z' }));
const rows = Array.from({ length: 10000 }, (_, index) => ({ id: `r${index}`, project_id: `p${index % 5000}`, name: `Výzkum nástroje ${index}`, summary: 'Přehled českých funkcí a účtování. '.repeat(8), pricing_model: index % 2 ? 'Zdarma' : 'Měsíční předplatné', lessons: 'Ponechat vlastní data', social_content: 'Příklady práce', useful_features: ['Přehledné ovládání', 'Společné projekty'] }));
const queries = ['výzkum', 'vyzkum nastroje', 'českých zdarma', 'ceskych predplatne', '9999', 'projekty vlastní', 'ovládání přehled', 'nenalezeno', 'výzkum 500', 'měsíční', 'prehledne', 'uctovani', '5000', 'funkci', 'priklady', 'data', 'vlastni projekty', 'nastroje zdarma', 'ceskych', ''];
const identity = values => values.map(value => value.id);
const oldOrder = identity(implementation.beforeOrder(projects, rows)), newOrder = identity(implementation.afterOrder(projects, rows));
if (JSON.stringify(oldOrder) !== JSON.stringify(newOrder)) throw Error('Project ordering changed');
const index = implementation.makeIndex(rows), oldResults = queries.map(query => identity(implementation.beforeFilter(rows, query))), newResults = queries.map(query => identity(implementation.afterFilter(rows, index, query)));
if (JSON.stringify(oldResults) !== JSON.stringify(newResults)) throw Error('Search results changed');
function samples(action) { action(); return Array.from({ length: 5 }, () => { const start = performance.now(); action(); return Number((performance.now() - start).toFixed(3)); }); }
const evidence = { baseline, sourceHashes: { beforePanel: createHash('sha256').update(before).digest('hex'), afterPanel: createHash('sha256').update(after).digest('hex'), afterDomain: createHash('sha256').update(readFileSync('src/lib/competition.ts')).digest('hex') }, synthetic: { projects: projects.length, competitors: rows.length, queries: queries.length }, parity: { projectIds: oldOrder.length, allProjectIdsExact: true, allTwentyQueryResultsExact: true }, projectOrderMs: { before: samples(() => implementation.beforeOrder(projects, rows)), after: samples(() => implementation.afterOrder(projects, rows)) }, twentySearchesIncludingIndexMs: { before: samples(() => queries.map(query => implementation.beforeFilter(rows, query))), after: samples(() => { const index = implementation.makeIndex(rows); return queries.map(query => implementation.afterFilter(rows, index, query)); }) }, limits: 'Local JavaScript expression timings with synthetic data. Not production latency, database cost or provider savings.' };
writeFileSync('docs/reports/app-wide-audit-2026-10-23/competition-cpu.json', JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
