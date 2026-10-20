/**
 * Read-only live check of the native DNESKAi free-feed adapters.
 *
 * Calls `collectNativeDneskaiFeed` for every registered non-Instagram source with the same
 * `since`/`maxItems` the collection runner would send for a first run (no stored cursor:
 * `since = now - 7 days`). It writes no database row, sends no credential and calls no model
 * or paid service. Output is a local JSON file for comparison with the Quorum bridge.
 *
 * Usage (jiti ignores `--conditions`, so alias `server-only` to its empty export):
 *   JITI_ALIAS="{\"@/\":\"$PWD/src/\",\"server-only\":\"$PWD/node_modules/server-only/empty.js\"}" \
 *   node node_modules/.bin/jiti scripts/dneskai-native-feeds.ts \
 *     --out /path/native.json [--since ISO] [--max-items N] [--only id,id] [--concurrency 4] [--egress proxy] [--plan-only]
 *
 * `--egress proxy` (with NODE_USE_ENV_PROXY=1) swaps the pinned direct transport for global fetch
 * through the environment proxy, for sandboxes whose direct egress publishers reject.
 * `--plan-only` writes the request plan (`since`, source ids, kinds, maxItems) instead of fetching,
 * so a second provider can be called with identical inputs.
 */
import { writeFile } from 'node:fs/promises';
import { DNESKAI_SOURCES } from '../src/lib/marketing/dneskai-registry';
import { collectNativeDneskaiFeed } from '../src/lib/marketing/dneskai-native-feed';

function option(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index > 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const out = option('out');
  if (!out) throw new Error('Usage: --out FILE [--since ISO] [--max-items N] [--only id,id] [--concurrency N]');
  const started = new Date();
  const since = option('since') ?? new Date(started.getTime() - 7 * 86_400_000).toISOString();
  const maxOverride = option('max-items') ? Number(option('max-items')) : undefined;
  const only = option('only')?.split(',').filter(Boolean);
  const concurrency = Math.max(1, Math.min(8, Number(option('concurrency') ?? 4)));
  // Test environments only: replace the pinned direct TLS transport with global fetch, which
  // honours HTTPS_PROXY when NODE_USE_ENV_PROXY=1. DNS public-address checks still run.
  const viaProxy = option('egress') === 'proxy';
  if (viaProxy && process.env.NODE_USE_ENV_PROXY !== '1') throw new Error('--egress proxy requires NODE_USE_ENV_PROXY=1');
  const sources = DNESKAI_SOURCES.filter(source => source.kind !== 'instagram' && (!only || only.includes(source.id)))
    .map(source => maxOverride ? { ...source, maxItems: maxOverride } : source);
  if (process.argv.includes('--plan-only')) {
    // The same request plan for another provider (the Quorum bridge comparison).
    await writeFile(out, JSON.stringify({ since, sources: sources.map(source => ({ id: source.id, kind: source.kind, maxItems: source.maxItems })) }, null, 1));
    return;
  }
  const results: unknown[] = new Array(sources.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next++;
      const source = sources[index];
      if (!source) return;
      const startedAt = new Date();
      const response = await collectNativeDneskaiFeed(source, since, { signal: AbortSignal.timeout(45_000), now: startedAt, ...(viaProxy ? { fetcher: globalThis.fetch } : {}) });
      const row = response.sources[0]!;
      results[index] = {
        sourceId: source.id, kind: source.kind, maxItems: source.maxItems,
        startedAt: startedAt.toISOString(), finishedAt: new Date().toISOString(),
        status: row.status, errorCode: row.errorCode,
        items: row.items.map(item => ({ externalId: item.externalId, url: item.url, publishedAt: item.publishedAt, fetchedAt: item.fetchedAt, title: item.title,
          ...(item.dateEstimated ? { dateEstimated: true } : {}), ...(item.imageUrl ? { imageUrl: item.imageUrl } : {}) })),
      };
      console.log(`${source.id}\t${row.status}\t${row.errorCode ?? ''}\t${row.items.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  await writeFile(out, JSON.stringify({ provider: 'native', egress: viaProxy ? 'proxy' : 'direct-pinned', generatedAt: started.toISOString(), finishedAt: new Date().toISOString(), since, sources: results }, null, 2));
}

main().catch(error => { console.error(error instanceof Error ? error.message : 'native feed check failed'); process.exitCode = 1; });
