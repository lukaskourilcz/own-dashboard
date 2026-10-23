import 'server-only';
import type { DneskaiSource } from './dneskai-contracts';
import { DNESKAI_EDUCATION_SOURCES, dneskaiSourceById, dueDneskaiSources, isDneskaiEducationSource } from './dneskai-registry';
import { DneskaiSourceRowSchema, dneskaiSourceFromRow, type DneskaiSourceRow } from './dneskai-source-list';
import { dneskaiSourcesTableEnabled } from './dneskai-evidence-rollout';

/**
 * Which sources the collection and the scouting step read (#174): the registry file, or the owner's rows of
 * marketing_dneskai_sources while DNESKAI_SOURCES_TABLE_ENABLED is on and the owner has rows. One interface for both,
 * so the pipeline does not care where a source came from.
 */
export interface DneskaiSourceCatalog {
  readonly origin: 'registry' | 'table';
  /** The sources due on a Prague date; education sources only with `education` (DNESKAI_SCOUTING_ENABLED). */
  due(date: string, options?: { education?: boolean }): DneskaiSource[];
  /** A source by id, enabled or not; a registry id the table no longer has still resolves for runs already admitted. */
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

/** A catalog over the owner's rows. Disabled rows are never due but still resolve by id. */
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
    byId: (sourceId: string) => byId.get(sourceId)?.source ?? dneskaiSourceById(sourceId),
    isEducation: (sourceId: string) => byId.has(sourceId) ? byId.get(sourceId)!.row.topic === 'education' : isDneskaiEducationSource(sourceId),
    educationIds: () => rows.filter((row) => row.topic === 'education').map((row) => row.sourceId),
  });
}

type SourceDb = { from: (table: 'marketing_dneskai_sources') => unknown };
type Query = { select: (columns: string) => Query; eq: (column: string, value: string) => Query; order: (column: string, options: { ascending: boolean }) => Query; limit: (n: number) => Promise<{ data: unknown[] | null; error: unknown }> };

/** The owner's rows in the order they were added (the seed keeps the registry's order). Unreadable rows are skipped. */
export async function readDneskaiSourceRows(db: SourceDb, owner: string, project: string): Promise<DneskaiSourceRow[]> {
  const { data, error } = await (db.from('marketing_dneskai_sources') as Query)
    .select('source_id,kind,topic,handle_or_url,name,tier,weekdays,max_items,enabled').eq('user_id', owner).eq('project_id', project)
    .order('created_at', { ascending: true }).limit(200);
  if (error) throw new Error('sources-unavailable');
  return (data ?? []).flatMap((value) => {
    const row = value as Record<string, unknown>;
    const parsed = DneskaiSourceRowSchema.safeParse({ sourceId: row.source_id, kind: row.kind, topic: row.topic, handleOrUrl: row.handle_or_url, name: row.name,
      tier: row.tier, weekdays: row.weekdays, maxItems: row.max_items, enabled: row.enabled });
    return parsed.success ? [parsed.data] : [];
  });
}

/**
 * The catalog for one owner's project: the table while the switch is on and the owner has rows, the registry otherwise
 * (switch off, migration not applied, or Zdroje never opened since the switch went on). A read error falls back too,
 * so a missing table never stops the night.
 */
export async function loadDneskaiSourceCatalog(db: SourceDb, owner: string, project: string, env: Record<string, string | undefined> = process.env): Promise<DneskaiSourceCatalog> {
  if (!dneskaiSourcesTableEnabled(env)) return DNESKAI_REGISTRY_CATALOG;
  const rows = await readDneskaiSourceRows(db, owner, project).catch(() => []);
  return rows.length ? dneskaiTableCatalog(rows) : DNESKAI_REGISTRY_CATALOG;
}
