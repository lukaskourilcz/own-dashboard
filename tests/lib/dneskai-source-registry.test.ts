import { describe, expect, it, vi } from 'vitest';
import { DNESKAI_EDUCATION_SOURCES, DNESKAI_SOURCES, dneskaiFeedAdapter, dneskaiSourceTier } from '@/lib/marketing/dneskai-registry';
import { DNESKAI_NATIVE_FEED_IDS, dneskaiNativeSourceConfig } from '@/lib/marketing/dneskai-native-feed';
import { dneskaiSourceTier as eventTier } from '@/lib/marketing/dneskai-events';
import before from '../fixtures/dneskai-registry-before-c6.json';
vi.mock('server-only', () => ({}));

/**
 * Audit C6 merged two source lists (dneskai-registry.ts and free-feeds/registry.json) and the tier table in
 * dneskai-events.ts into dneskai-registry.ts. The fixture holds what the three described before the merge:
 * the public source rows, the adapter configuration (without the unread weight, tags and stage fields and
 * the always-true enabled flag) and every source's tier. A deliberate registry change regenerates it.
 */
describe('one DNESKAi source registry', () => {
 it('keeps every public source row, its order and its cadence', () => {
  expect(JSON.parse(JSON.stringify(DNESKAI_SOURCES))).toEqual(before.sources);
 });
 it('derives the same adapter configuration for every feed', () => {
  const adapters = before.adapters as Record<string, Record<string, unknown>>;
  // The news feeds keep their configuration; the education feeds (#151) follow them.
  const education = DNESKAI_EDUCATION_SOURCES.filter(source => source.kind !== 'instagram').map(source => source.id);
  expect([...DNESKAI_NATIVE_FEED_IDS]).toEqual([...Object.keys(adapters), ...education]);
  for (const id of Object.keys(adapters)) expect(dneskaiNativeSourceConfig(id)).toEqual(adapters[id]);
  expect(DNESKAI_SOURCES.filter(source => source.kind === 'instagram').every(source => dneskaiNativeSourceConfig(source.id) === undefined)).toBe(true);
  expect(dneskaiFeedAdapter('github-ai-releases')?.repos).toHaveLength(7);
  expect(dneskaiFeedAdapter('openai-blog')).toEqual({});
  expect(dneskaiFeedAdapter('unknown')).toBeUndefined();
 });
 it('ranks with the same tiers, now read from the registry', () => {
  for (const source of DNESKAI_SOURCES) {
   expect(dneskaiSourceTier(source.id)).toBe((before.tiers as Record<string, number>)[source.id]);
   expect(eventTier(source.id)).toBe(dneskaiSourceTier(source.id));
  }
  expect(dneskaiSourceTier('unknown')).toBe(1);
 });
 it('keeps adapter-only facts out of the public rows', () => {
  for (const source of DNESKAI_SOURCES) expect(Object.keys(source).sort()).toEqual(['id', 'kind', 'maxItems', 'name', 'url', 'weekdays']);
 });
});
