import { z } from 'zod';
import { DneskaiSourceSchema, type DneskaiSource } from './dneskai-contracts';
import { dneskaiRegistrySeed } from './dneskai-registry';

/**
 * Zdroje as an editable list (#174). Browser-safe: the row shape of marketing_dneskai_sources, the seed taken from the
 * registry file, reading an owner's input as an Instagram handle or a website, and the mapping to the collection's
 * DneskaiSource. Server code reads the rows only while DNESKAI_SOURCES_TABLE_ENABLED is "true".
 */
export const DNESKAI_SOURCE_LIST_VERSION = 'dneskai-source-list/1' as const;
export const DNESKAI_SOURCE_KINDS = DneskaiSourceSchema.shape.kind.options;
export const DNESKAI_SOURCE_TOPICS = ['news', 'education'] as const;
/** Kinds the owner can add: everything else (arXiv, GitHub, Hacker News…) comes from the registry with code-owned parameters. */
export const DNESKAI_ADDABLE_KINDS = ['instagram', 'rss', 'html'] as const;
export const DNESKAI_SOURCE_LIMIT = 120;
const HANDLE = /^[a-z0-9._]{1,30}$/;
const SOURCE_ID = /^[a-z0-9][a-z0-9:._-]{0,79}$/;

export const DneskaiSourceRowSchema = z.strictObject({
  sourceId: z.string().regex(SOURCE_ID), kind: z.enum(DNESKAI_SOURCE_KINDS), topic: z.enum(DNESKAI_SOURCE_TOPICS),
  handleOrUrl: z.string().min(1).max(2048), name: z.string().trim().min(1).max(120), tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), maxItems: z.number().int().min(1).max(20), enabled: z.boolean(),
}).superRefine((row, context) => {
  if (row.kind === 'instagram' ? !HANDLE.test(row.handleOrUrl) || row.sourceId !== `instagram:${row.handleOrUrl}` : !/^https:\/\/\S+$/.test(row.handleOrUrl)) {
    context.addIssue({ code: 'custom', message: 'source-address-invalid', path: ['handleOrUrl'] });
  }
});
export type DneskaiSourceRow = z.infer<typeof DneskaiSourceRowSchema>;

/** One row as Zdroje shows it: the stored source and what the last nights read from it. */
export const DneskaiSourceListItemSchema = z.strictObject({
  row: DneskaiSourceRowSchema,
  lastReadAt: z.string().nullable(), lastItems: z.number().int().min(0).nullable(), lastErrorCode: z.string().max(100).nullable(),
});
export const DneskaiSourceListSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_SOURCE_LIST_VERSION),
  /** False while DNESKAI_SOURCES_TABLE_ENABLED is off (or in the preview): the list is the registry file, read-only. */
  editable: z.boolean(),
  items: z.array(DneskaiSourceListItemSchema).max(DNESKAI_SOURCE_LIMIT + 10),
});
export type DneskaiSourceList = z.infer<typeof DneskaiSourceListSchema>;

export const DneskaiSourceActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), projectId: z.uuid(), source: DneskaiSourceRowSchema }),
  z.strictObject({ action: z.literal('remove'), projectId: z.uuid(), sourceId: z.string().regex(SOURCE_ID) }),
]);
export type DneskaiSourceAction = z.infer<typeof DneskaiSourceActionSchema>;

/** The registry file as the first rows of the table. */
export function dneskaiSourceSeedRows(): DneskaiSourceRow[] {
  return dneskaiRegistrySeed().map((source) => DneskaiSourceRowSchema.parse({
    sourceId: source.id, kind: source.kind, topic: source.topic, name: source.name, tier: source.tier, weekdays: source.weekdays,
    maxItems: source.maxItems, enabled: source.enabled, handleOrUrl: source.kind === 'instagram' ? instagramHandle(source.url)! : source.url,
  }));
}

/** The handle in an Instagram profile URL, lower-cased; null for anything else. */
export function instagramHandle(value: string): string | null {
  const trimmed = value.trim().replace(/^@/, '');
  if (HANDLE.test(trimmed.toLowerCase()) && !trimmed.includes('/')) return trimmed.toLowerCase();
  try {
    const url = new URL(trimmed);
    if (!/^(www\.)?instagram\.com$/.test(url.hostname)) return null;
    const handle = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    return handle && HANDLE.test(handle) && !['p', 'reel', 'reels', 'explore', 'stories'].includes(handle) ? handle : null;
  } catch { return null; }
}

/**
 * Reads what the owner typed in „Přidat zdroj“: @handle, a bare handle or an instagram.com profile URL is an Instagram
 * profile; any other https address is a website, read as a feed when its address looks like one (rss, atom, feed,
 * .xml) and as a page otherwise. Null when it is neither.
 */
export function dneskaiDetectSource(input: string): { kind: 'instagram'; handle: string } | { kind: 'rss' | 'html'; url: string; host: string } | null {
  const value = input.trim();
  if (!value) return null;
  const handle = instagramHandle(value);
  if (handle) return { kind: 'instagram', handle };
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  url.protocol = 'https:'; url.hash = '';
  if (!url.hostname.includes('.') || url.username || url.password) return null;
  const feed = /(rss|atom|feed)|\.xml$/i.test(url.pathname + url.search);
  return { kind: feed ? 'rss' : 'html', url: url.href, host: url.hostname.replace(/^www\./, '') };
}

/** FNV-1a, 32 bits, as hex: short and synchronous, enough to keep two URLs of one host apart. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (const char of new TextEncoder().encode(value)) { hash ^= char; hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(16).padStart(8, '0');
}

/** A stable id for a new website: web-<host with dashes>-<6 hex of the URL>; the native feed adapters accept only [a-z0-9-]. */
export function dneskaiWebSourceId(url: string): string {
  const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 60);
  return `web-${host}-${fnv1a(url).slice(0, 6)}`;
}

/** The collection's view of a row: Instagram handles become profile URLs. */
export function dneskaiSourceFromRow(row: DneskaiSourceRow): DneskaiSource {
  return DneskaiSourceSchema.parse({
    id: row.sourceId, name: row.name, kind: row.kind, weekdays: row.weekdays, maxItems: row.maxItems,
    url: row.kind === 'instagram' ? `https://www.instagram.com/${row.handleOrUrl}/` : row.handleOrUrl,
  });
}

/** The domain or @handle Zdroje shows for a row. */
export function dneskaiSourceLabel(row: Pick<DneskaiSourceRow, 'kind' | 'handleOrUrl'>): string {
  if (row.kind === 'instagram') return `@${row.handleOrUrl}`;
  try { return new URL(row.handleOrUrl).hostname.replace(/^www\./, ''); } catch { return row.handleOrUrl; }
}
