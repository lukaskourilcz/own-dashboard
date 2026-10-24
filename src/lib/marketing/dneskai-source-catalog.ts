import 'server-only';
import type { DneskaiSource } from './dneskai-contracts';
import { DNESKAI_EDUCATION_SOURCES, dneskaiSourceById, dueDneskaiSources, isDneskaiEducationSource } from './dneskai-registry';
import { DneskaiSourceRowSchema, dneskaiSourceFromRow, DNESKAI_SOURCE_LIMIT, type DneskaiSourceRow } from './dneskai-source-list';
import { dneskaiSourcesTableEnabled } from './dneskai-evidence-rollout';
import { z } from 'zod';
import { awaitWithSignal } from '@/lib/abortable';

/**
 * Which sources the collection and the scouting step read (#174): the registry file, or the owner's rows of
 * marketing_dneskai_sources while DNESKAI_SOURCES_TABLE_ENABLED is on. One interface for both,
 * so the pipeline does not care where a source came from.
 */
export interface DneskaiSourceCatalog {
  readonly origin: 'registry' | 'table';
  /** The sources due on a Prague date; education sources only with `education` (DNESKAI_SCOUTING_ENABLED). */
  due(date: string, options?: { education?: boolean }): DneskaiSource[];
  /** A currently enabled source by id. Removed/disabled sources cannot resume queued reads. */
  byId(sourceId: string): DneskaiSource | undefined;
  isEducation(sourceId: string): boolean;
  educationIds(): string[];
}

/** The marketing_dneskai_admit limit: at most 42 sources a night. */
export const DNESKAI_ADMIT_SOURCE_LIMIT = 42;

export const DNESKAI_REGISTRY_CATALOG: DneskaiSourceCatalog = Object.freeze({
  origin: 'registry' as const,
  due: (date: string, options: { education?: boolean } = {}) => dueDneskaiSources(date, options),
  byId: dneskaiSourceById,
  isEducation: isDneskaiEducationSource,
  educationIds: () => DNESKAI_EDUCATION_SOURCES.map((source) => source.id),
});

/** A catalog over the owner's rows. Historical topic classification never grants read admission. */
export function dneskaiTableCatalog(rows: readonly DneskaiSourceRow[]): DneskaiSourceCatalog {
  const byId = new Map(rows.map((row) => [row.sourceId, { row, source: dneskaiSourceFromRow(row) }]));
  const weekday = (date: string) => {
    const instant = new Date(`${date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(instant.getTime()) || instant.toISOString().slice(0, 10) !== date) throw new Error('collection-date-invalid');
    return instant.getUTCDay();
  };
  return Object.freeze({
    origin: 'table' as const,
    due(date: string, options: { education?: boolean } = {}) {
      const day = weekday(date);
      const due = rows.filter((row) => row.enabled && row.weekdays.includes(day) && (row.topic === 'news' || options.education));
      // News first, in the registry's order (the rows keep it), so a cap never drops a news source for an education one.
      return [...due.filter((row) => row.topic === 'news'), ...due.filter((row) => row.topic === 'education')]
        .slice(0, DNESKAI_ADMIT_SOURCE_LIMIT).map((row) => byId.get(row.sourceId)!.source);
    },
    byId: (sourceId: string) => byId.get(sourceId)?.row.enabled ? byId.get(sourceId)!.source : undefined,
    isEducation: (sourceId: string) => byId.has(sourceId) ? byId.get(sourceId)!.row.topic === 'education' : isDneskaiEducationSource(sourceId),
    educationIds: () => rows.filter((row) => row.enabled && row.topic === 'education').map((row) => row.sourceId),
  });
}

type SourceDb = { from: (table: 'marketing_dneskai_sources') => unknown };
type Query = { select: (columns: string, options: { count: 'exact' }) => Query; eq: (column: string, value: string) => Query; order: (column: string, options: { ascending: boolean }) => Query; retry: (enabled: false) => Query; abortSignal: (signal: AbortSignal) => Query; limit: (n: number) => PromiseLike<{ data: unknown[] | null; error: unknown; count: number | null }> };

/** A complete validated owner catalog. Refuse partial/malformed reads; an empty catalog stays empty. */
export async function readDneskaiSourceRows(db: SourceDb, owner: string, project: string, parent?: AbortSignal): Promise<DneskaiSourceRow[]> {
  z.uuid().parse(owner); z.uuid().parse(project); const signal = AbortSignal.any([AbortSignal.timeout(15_000), ...(parent ? [parent] : [])]);
  signal.throwIfAborted();
  const { data, error, count } = await awaitWithSignal((db.from('marketing_dneskai_sources') as Query)
    .select('source_id,kind,topic,handle_or_url,name,tier,weekdays,max_items,enabled', { count: 'exact' }).eq('user_id', owner).eq('project_id', project)
    .order('created_at', { ascending: true }).order('source_id', { ascending: true }).retry(false).abortSignal(signal).limit(DNESKAI_SOURCE_LIMIT + 1), signal);
  if (error || !Array.isArray(data) || data.length > DNESKAI_SOURCE_LIMIT || count !== data.length) throw new Error('sources-unavailable');
  const rows = data.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('sources-unavailable');
    const row = value as Record<string, unknown>;
    const parsed = DneskaiSourceRowSchema.safeParse({ sourceId: row.source_id, kind: row.kind, topic: row.topic, handleOrUrl: row.handle_or_url, name: row.name,
      tier: row.tier, weekdays: row.weekdays, maxItems: row.max_items, enabled: row.enabled });
    if (!parsed.success) throw new Error('sources-unavailable');
    return parsed.data;
  });
  if (new Set(rows.map(row => row.sourceId)).size !== rows.length) throw new Error('sources-unavailable');
  return rows;
}

/**
 * The registry is only for the explicit switch-off path. With owner settings
 * enabled, neither failed reads nor removed sources may silently enable it.
 */
export async function loadDneskaiSourceCatalog(db: SourceDb, owner: string, project: string, env: Record<string, string | undefined> = process.env): Promise<DneskaiSourceCatalog> {
  if (!dneskaiSourcesTableEnabled(env)) return DNESKAI_REGISTRY_CATALOG;
  return dneskaiTableCatalog(await readDneskaiSourceRows(db, owner, project));
}
