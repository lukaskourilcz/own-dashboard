/**
 * Compare two DNESKAi feed check outputs (for example the Quorum bridge and the native adapters)
 * and print a Markdown table. Pure local file comparison: no network, no database.
 *
 * Usage: node node_modules/.bin/jiti scripts/dneskai-feed-compare.ts LEFT.json RIGHT.json [--labels bridge,native]
 *
 * Each input is `{ provider, since, sources: [{ sourceId, status, errorCode, startedAt, items: [{ externalId, url, publishedAt }] }] }`
 * as written by `scripts/dneskai-native-feeds.ts`.
 */
import { readFile } from 'node:fs/promises';

type Item = { externalId: string; url: string; publishedAt: string | null; imageUrl?: string; dateEstimated?: boolean };
type Row = { sourceId: string; status: string; errorCode: string | null; startedAt: string; items: Item[] };
type Run = { provider: string; since: string; generatedAt: string; sources: Row[] };

export function compareFeedRuns(left: Run, right: Run) {
  const ids = [...new Set([...left.sources, ...right.sources].map(row => row.sourceId))].sort();
  return ids.map(sourceId => {
    const a = left.sources.find(row => row.sourceId === sourceId);
    const b = right.sources.find(row => row.sourceId === sourceId);
    const keyA = new Map((a?.items ?? []).map(item => [item.url, item]));
    const keyB = new Map((b?.items ?? []).map(item => [item.url, item]));
    const shared = [...keyA.keys()].filter(url => keyB.has(url));
    const sameId = shared.filter(url => keyA.get(url)!.externalId === keyB.get(url)!.externalId).length;
    const sameDate = shared.filter(url => keyA.get(url)!.publishedAt === keyB.get(url)!.publishedAt).length;
    const identical = a && b && a.items.length === b.items.length && shared.length === a.items.length && sameId === shared.length;
    return {
      sourceId,
      left: a ? { status: a.status, errorCode: a.errorCode, count: a.items.length } : null,
      right: b ? { status: b.status, errorCode: b.errorCode, count: b.items.length, dated: b.items.filter(item => item.publishedAt).length, estimated: b.items.filter(item => item.dateEstimated).length, images: b.items.filter(item => item.imageUrl).length } : null,
      shared: shared.length, sameId, sameDate,
      verdict: !a || !b ? 'missing' : identical && sameDate === shared.length && a.status === b.status && a.errorCode === b.errorCode ? 'identical'
        : identical && sameDate === shared.length ? 'same items, different code' : identical ? 'same items, different dates'
        : shared.length ? 'overlap' : a.items.length || b.items.length ? 'disjoint' : 'both empty',
    };
  });
}

function cell(value: { status: string; errorCode: string | null; count: number } | null) {
  return value ? `${value.status}${value.errorCode ? ` \`${value.errorCode}\`` : ''} · ${value.count}` : '—';
}

async function main() {
  const [leftPath, rightPath] = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const labelsIndex = process.argv.indexOf('--labels');
  const [leftLabel, rightLabel] = labelsIndex > 0 ? process.argv[labelsIndex + 1]!.split(',') : ['left', 'right'];
  if (!leftPath || !rightPath) throw new Error('Usage: LEFT.json RIGHT.json [--labels a,b]');
  const left = JSON.parse(await readFile(leftPath, 'utf8')) as Run, right = JSON.parse(await readFile(rightPath, 'utf8')) as Run;
  if (left.since !== right.since) throw new Error('The two runs used different windows');
  const rows = compareFeedRuns(left, right);
  console.log(`| Source | ${leftLabel} | ${rightLabel} | Shared URLs | Same externalId | Same publishedAt | ${rightLabel} dated / estimated / imageUrl | Verdict |`);
  console.log('|---|---|---|---|---|---|---|---|');
  for (const row of rows) {
    console.log(`| \`${row.sourceId}\` | ${cell(row.left)} | ${cell(row.right)} | ${row.shared} | ${row.sameId} | ${row.sameDate} | ${row.right ? `${row.right.dated} / ${row.right.estimated} / ${row.right.images}` : '—'} | ${row.verdict} |`);
  }
  const counts = rows.reduce<Record<string, number>>((total, row) => ({ ...total, [row.verdict]: (total[row.verdict] ?? 0) + 1 }), {});
  console.log(`\nWindow since ${left.since}; ${leftLabel} started ${left.generatedAt}, ${rightLabel} started ${right.generatedAt}. Verdicts: ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(', ')}.`);
}

if (process.argv[1]?.endsWith('dneskai-feed-compare.ts')) main().catch(error => { console.error(error instanceof Error ? error.message : 'comparison failed'); process.exitCode = 1; });
