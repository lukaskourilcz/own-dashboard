import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { DNESKAI_EDUCATION_SOURCES, DNESKAI_SOURCES, dueDneskaiSources } from '@/lib/marketing/dneskai-registry';
import { dneskaiDetectSource, dneskaiSourceFromRow, dneskaiSourceLabel, dneskaiSourceSeedRows, dneskaiWebSourceId, instagramHandle } from '@/lib/marketing/dneskai-source-list';
import { DNESKAI_REGISTRY_CATALOG, dneskaiTableCatalog, loadDneskaiSourceCatalog } from '@/lib/marketing/dneskai-source-catalog';
import { dneskaiNativeSourceConfig } from '@/lib/marketing/dneskai-native-feed';

describe('Zdroje source rows (#174)', () => {
  it('seeds every registry source with its tier and topic, and the two unchecked profiles switched off', () => {
    const seed = dneskaiSourceSeedRows();
    expect(seed.filter((row) => row.enabled).map(dneskaiSourceFromRow)).toEqual([...DNESKAI_SOURCES, ...DNESKAI_EDUCATION_SOURCES]);
    expect(seed.filter((row) => !row.enabled).map((row) => row.sourceId)).toEqual(['instagram:aimanie', 'instagram:digitalnihumanista']);
    expect(seed.find((row) => row.sourceId === 'instagram:mosseri')).toMatchObject({ handleOrUrl: 'mosseri', tier: 0, topic: 'news' });
    expect(seed.find((row) => row.sourceId === 'product-hunt')).toMatchObject({ tier: 2, topic: 'education' });
  });

  it('reads an owner’s input as a handle, a profile URL, a feed or a page', () => {
    expect(dneskaiDetectSource('@NewProfile')).toEqual({ kind: 'instagram', handle: 'newprofile' });
    expect(dneskaiDetectSource('https://www.instagram.com/rowancheung/?hl=cs')).toEqual({ kind: 'instagram', handle: 'rowancheung' });
    expect(instagramHandle('https://www.instagram.com/reel/ABC/')).toBeNull();
    expect(dneskaiDetectSource('example.com/blog/feed')).toEqual({ kind: 'rss', url: 'https://example.com/blog/feed', host: 'example.com' });
    expect(dneskaiDetectSource('http://www.example.org/news')).toEqual({ kind: 'html', url: 'https://www.example.org/news', host: 'example.org' });
    expect(dneskaiDetectSource('not a source')).toBeNull();
    expect(dneskaiDetectSource('')).toBeNull();
    expect(dneskaiSourceLabel({ kind: 'html', handleOrUrl: 'https://www.example.org/news' })).toBe('example.org');
    expect(dneskaiSourceLabel({ kind: 'instagram', handleOrUrl: 'mosseri' })).toBe('@mosseri');
  });

  it('gives a website a stable id the native adapters accept, and the native feed reads it', () => {
    const id = dneskaiWebSourceId('https://www.example.org/feed.xml');
    expect(id).toMatch(/^web-example-org-[0-9a-f]{6}$/);
    expect(dneskaiWebSourceId('https://www.example.org/feed.xml')).toBe(id);
    expect(dneskaiWebSourceId('https://www.example.org/other.xml')).not.toBe(id);
    expect(dneskaiNativeSourceConfig(id)).toBeUndefined();
  });

  it('a table catalog keeps news first, skips disabled rows and still resolves registry ids', () => {
    const seed = dneskaiSourceSeedRows();
    const catalog = dneskaiTableCatalog([...seed, { sourceId: 'web-example-org-abcdef', kind: 'rss', topic: 'education', handleOrUrl: 'https://example.org/feed', name: 'Example', tier: 1, weekdays: [1], maxItems: 10, enabled: true }]);
    const due = catalog.due('2026-10-26', { education: true }).map((source) => source.id);
    expect(due).toContain('web-example-org-abcdef');
    expect(due).not.toContain('instagram:aimanie');
    expect(due.indexOf('web-example-org-abcdef')).toBeGreaterThan(due.findLastIndex((sourceId) => !catalog.isEducation(sourceId)));
    expect(catalog.due('2026-10-26').map((source) => source.id)).toEqual(dueDneskaiSources('2026-10-26').map((source) => source.id));
    expect(catalog.isEducation('web-example-org-abcdef')).toBe(true);
    expect(catalog.byId('openai-blog')?.name).toBe('OpenAI');
    expect(dneskaiTableCatalog(seed.filter((row) => row.sourceId !== 'openai-blog')).byId('openai-blog')?.name).toBe('OpenAI');
  });

  it('falls back to the registry while the switch is off, on a read error and before the first rows', async () => {
    const db = (data: unknown[] | null, error: unknown = null) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order']) builder[method] = () => builder;
      builder.limit = async () => ({ data, error });
      return { from: () => builder };
    };
    const owner = '11111111-1111-4111-8111-111111111111', project = '22222222-2222-4222-8222-222222222222';
    expect(await loadDneskaiSourceCatalog(db([]), owner, project, {})).toBe(DNESKAI_REGISTRY_CATALOG);
    expect(await loadDneskaiSourceCatalog(db([]), owner, project, { DNESKAI_SOURCES_TABLE_ENABLED: 'true' })).toBe(DNESKAI_REGISTRY_CATALOG);
    expect(await loadDneskaiSourceCatalog(db(null, { message: 'relation does not exist' }), owner, project, { DNESKAI_SOURCES_TABLE_ENABLED: 'true' })).toBe(DNESKAI_REGISTRY_CATALOG);
    const rows = [{ source_id: 'instagram:mosseri', kind: 'instagram', topic: 'news', handle_or_url: 'mosseri', name: 'mosseri', tier: 0, weekdays: [1], max_items: 10, enabled: true }];
    expect((await loadDneskaiSourceCatalog(db(rows), owner, project, { DNESKAI_SOURCES_TABLE_ENABLED: 'true' })).origin).toBe('table');
  });
});
