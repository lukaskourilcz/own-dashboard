import { z } from 'zod';
import { DneskaiSourceSchema, type DneskaiSource } from './dneskai-contracts';
import { dneskaiRegistrySeed } from './dneskai-registry';
import { databaseTimestamp } from '@/lib/database-version';
import { safeWebUrl } from '@/lib/web-url';

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
function httpsSource(value: string): boolean {
  const safe = safeWebUrl(value, 2048);
  if (!safe || !/^https:\/\/\S+$/.test(value) || value.includes('\\')) return false;
  return new URL(safe).port === '';
}

export const DneskaiSourceRowSchema = z.strictObject({
  sourceId: z.string().regex(SOURCE_ID), kind: z.enum(DNESKAI_SOURCE_KINDS), topic: z.enum(DNESKAI_SOURCE_TOPICS),
  handleOrUrl: z.string().min(1).max(2048), name: z.string().min(1).max(120).refine(value => value === value.trim() && !/\p{Cc}/u.test(value)), tier: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7), maxItems: z.number().int().min(1).max(20), enabled: z.boolean(),
}).superRefine((row, context) => {
  if (row.kind === 'instagram' ? !HANDLE.test(row.handleOrUrl) || row.sourceId !== `instagram:${row.handleOrUrl}` : !httpsSource(row.handleOrUrl)) {
    context.addIssue({ code: 'custom', message: 'source-address-invalid', path: ['handleOrUrl'] });
  }
  if (new Set(row.weekdays).size !== row.weekdays.length) context.addIssue({ code: 'custom', message: 'source-days-invalid', path: ['weekdays'] });
});
export type DneskaiSourceRow = z.infer<typeof DneskaiSourceRowSchema>;
export const DneskaiSourceReceiptSchema = z.strictObject({
  kind: z.enum(['saved', 'removed', 'conflict']), ownerId: z.uuid(), projectId: z.uuid(), sourceId: z.string().regex(SOURCE_ID),
  source: DneskaiSourceRowSchema.nullable(),
}).refine(receipt => (!receipt.source || receipt.source.sourceId === receipt.sourceId)
  && (receipt.kind !== 'saved' || receipt.source !== null) && (receipt.kind !== 'removed' || receipt.source === null));
export type DneskaiSourceReceipt = z.infer<typeof DneskaiSourceReceiptSchema>;

/** One row as Zdroje shows it: the stored source and what the last nights read from it. */
export const DneskaiSourceListItemSchema = z.strictObject({
  row: DneskaiSourceRowSchema,
  lastReadAt: databaseTimestamp.nullable(), lastItems: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(), lastErrorCode: z.string().max(100).nullable(),
});
export const DneskaiSourceListSchema = z.strictObject({
  schemaVersion: z.literal(DNESKAI_SOURCE_LIST_VERSION),
  /** False while DNESKAI_SOURCES_TABLE_ENABLED is off (or in the preview): the list is the registry file, read-only. */
  editable: z.boolean(),
  /** Legacy read-only notice. Current unavailable table/history reads return 503 instead of a fallback. */
  notice: z.enum(['sources-table-unavailable']).nullable(),
  items: z.array(DneskaiSourceListItemSchema).max(DNESKAI_SOURCE_LIMIT),
}).refine(list => new Set(list.items.map(item => item.row.sourceId)).size === list.items.length);
export type DneskaiSourceList = z.infer<typeof DneskaiSourceListSchema>;

export const DneskaiSourceActionSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('save'), projectId: z.uuid(), source: DneskaiSourceRowSchema, expected: DneskaiSourceRowSchema.nullable() }),
  z.strictObject({ action: z.literal('remove'), projectId: z.uuid(), sourceId: z.string().regex(SOURCE_ID), expected: DneskaiSourceRowSchema }),
]).refine(action => !action.expected || action.expected.sourceId === (action.action === 'save' ? action.source.sourceId : action.sourceId));
export type DneskaiSourceAction = z.infer<typeof DneskaiSourceActionSchema>;

export function sameDneskaiSourceRow(a: DneskaiSourceRow | null, b: DneskaiSourceRow | null): boolean {
  if (!a || !b) return a === b;
  return a.sourceId === b.sourceId && a.kind === b.kind && a.topic === b.topic && a.handleOrUrl === b.handleOrUrl
    && a.name === b.name && a.tier === b.tier && a.maxItems === b.maxItems && a.enabled === b.enabled
    && a.weekdays.length === b.weekdays.length && a.weekdays.every((day, index) => day === b.weekdays[index]);
}
/** Shared API/browser confirmation; a shaped object alone is not proof of the requested change. */
export function confirmDneskaiSourceReceipt(value: unknown, action: DneskaiSourceAction, owner?: string): DneskaiSourceReceipt {
  const receipt = DneskaiSourceReceiptSchema.parse(value), id = action.action === 'save' ? action.source.sourceId : action.sourceId;
  if (receipt.projectId !== action.projectId || receipt.sourceId !== id || (owner !== undefined && receipt.ownerId !== owner)
    || (receipt.kind === 'saved' && (action.action !== 'save' || !sameDneskaiSourceRow(receipt.source, action.source)))
    || (receipt.kind === 'removed' && action.action !== 'remove')
    || (receipt.kind === 'conflict' && (sameDneskaiSourceRow(receipt.source, action.expected)
      || (action.action === 'save' ? sameDneskaiSourceRow(receipt.source, action.source) : receipt.source === null)))) throw new Error('source-save-unconfirmed');
  return receipt;
}
export const DneskaiSourceRefusalSchema = z.enum(['sources-unavailable', 'source-unavailable', 'source-address-changed', 'source-limit', 'invalid-source',
  'source-changed', 'source-save-unconfirmed', 'unauthorized', 'project-unavailable', 'not-found']);

/** The registry file as the first rows of the table. */
export function dneskaiSourceSeedRows(): DneskaiSourceRow[] {
  return dneskaiRegistrySeed().map((source) => DneskaiSourceRowSchema.parse({
    sourceId: source.id, kind: source.kind, topic: source.topic, name: source.name, tier: source.tier, weekdays: source.weekdays,
    maxItems: source.maxItems, enabled: source.enabled, handleOrUrl: source.kind === 'instagram' ? instagramHandle(source.url)! : source.url,
  }));
}

/** The handle in an Instagram profile URL, lower-cased; null for anything else. */
export function instagramHandle(value: string): string | null {
  if (value.length > 2048 || /[\p{Cc}\\]/u.test(value)) return null;
  const trimmed = value.trim().replace(/^@/, '');
  if (HANDLE.test(trimmed.toLowerCase()) && !trimmed.includes('/')) return trimmed.toLowerCase();
  try {
    const safe = safeWebUrl(trimmed, 2048); if (!safe) return null;
    const url = new URL(safe);
    if (!/^(www\.)?instagram\.com$/.test(url.hostname) || url.port) return null;
    const handle = /^\/([a-z0-9._]{1,30})\/?$/i.exec(url.pathname)?.[1]?.toLowerCase();
    return handle && HANDLE.test(handle) && !['p', 'reel', 'reels', 'explore', 'stories'].includes(handle) ? handle : null;
  } catch { return null; }
}

/**
 * Reads what the owner typed in „Přidat zdroj“: @handle, a bare handle or an instagram.com profile URL is an Instagram
 * profile; any other https address is a website, read as a feed when its address looks like one (rss, atom, feed,
 * .xml) and as a page otherwise. Null when it is neither.
 */
export function dneskaiDetectSource(input: string): { kind: 'instagram'; handle: string } | { kind: 'rss' | 'html'; url: string; host: string } | null {
  if (input.length > 2048 || /[\p{Cc}\\]/u.test(input)) return null;
  const value = input.trim();
  if (!value) return null;
  // A dotted bare value is a website. @ makes a dotted Instagram handle explicit.
  const handle = value.startsWith('@') || !/[.:/]/.test(value) ? instagramHandle(value) : null;
  if (handle) return { kind: 'instagram', handle };
  let url: URL;
  try { url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.port || url.username || url.password) return null;
  url.protocol = 'https:'; url.hash = '';
  if (url.href.length > 2048 || !url.hostname.includes('.') || !httpsSource(url.href)) return null;
  if (/^(www\.)?instagram\.com$/.test(url.hostname)) {
    const profile = instagramHandle(url.href);
    return profile ? { kind: 'instagram', handle: profile } : null;
  }
  const feed = /(rss|atom|feed)/i.test(url.pathname + url.search) || /\.xml$/i.test(url.pathname);
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

/** Registry display for the switch-off/preview paths; an optional legacy notice remains readable. */
export function dneskaiRegistrySourceList(states: ReadonlyMap<string, { lastReadAt: string | null; lastItems: number | null; lastErrorCode: string | null }> = new Map(),
  notice: DneskaiSourceList['notice'] = null): DneskaiSourceList {
  return { schemaVersion: DNESKAI_SOURCE_LIST_VERSION, editable: false, notice,
    items: dneskaiSourceSeedRows().map((row) => ({ row, ...(states.get(row.sourceId) ?? { lastReadAt: null, lastItems: null, lastErrorCode: null }) })) };
}
