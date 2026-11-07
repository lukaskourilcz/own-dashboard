import { DNESKAI_PLAN_READ_MAX_DAYS, DneskaiPlanReadSchema, type DneskaiPlanRead, type DneskaiPlanStatus } from './dneskai-plan-view';
import { qk } from '@/lib/queries/keys';

/**
 * The browser side of the DNESKAi publishing plan: the „Dnes a zítra“ tab and its 30-day plan read
 * GET /api/marketing/dneskai/plan through this port. In `/dev-preview` the deterministic fixture answers instead,
 * so nothing reaches a server (`src/lib/demo/dneskai-plan-fixtures.ts`).
 */
export class DneskaiPlanRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(code); this.name = 'DneskaiPlanRequestError'; }
}

/** Without `from` the server starts at today in Prague; without `days` it reads today and tomorrow. */
export type DneskaiPlanQuery = { from?: string; days?: number };

export interface DneskaiPlanApi {
  readonly preview: boolean;
  load(query: DneskaiPlanQuery, signal?: AbortSignal): Promise<DneskaiPlanRead>;
}

/** The read's URL; a day count outside 1–31 or a malformed date is left out, so the server default applies. */
export function dneskaiPlanUrl(query: DneskaiPlanQuery = {}): string {
  const params = new URLSearchParams();
  if (query.from && /^\d{4}-\d{2}-\d{2}$/.test(query.from)) params.set('from', query.from);
  if (query.days !== undefined && Number.isInteger(query.days) && query.days >= 1 && query.days <= DNESKAI_PLAN_READ_MAX_DAYS) params.set('days', String(query.days));
  const search = params.toString();
  return `/api/marketing/dneskai/plan${search ? `?${search}` : ''}`;
}

const codeShape = /^[a-z][a-z0-9_-]{0,99}$/;
export const liveDneskaiPlanApi: DneskaiPlanApi = {
  preview: false,
  async load(query, signal) {
    let response: Response;
    try { response = await fetch(dneskaiPlanUrl(query), { cache: 'no-store', signal }); }
    catch (error) { if (signal?.aborted) throw error; throw new DneskaiPlanRequestError('plan-unavailable', 0); }
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: unknown };
      throw new DneskaiPlanRequestError(typeof body.error === 'string' && codeShape.test(body.error) ? body.error : 'plan-unavailable', response.status);
    }
    const parsed = DneskaiPlanReadSchema.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw new DneskaiPlanRequestError('plan-unreadable', 502);
    return parsed.data;
  },
};

let demo: Promise<DneskaiPlanApi> | null = null;
/** The live port, or in the preview the deterministic fixture, loaded only when a preview first opens the tab. */
export function dneskaiPlanApi(preview: boolean): Promise<DneskaiPlanApi> {
  if (!preview) return Promise.resolve(liveDneskaiPlanApi);
  demo ??= import('@/lib/demo/dneskai-plan-fixtures').then((module) => module.demoDneskaiPlanApi);
  return demo;
}

/** The plan's query key, built on the centralised `qk` keys. */
export const dneskaiPlanKey = (query: DneskaiPlanQuery = {}) => [...qk.dneskaiPlan, query.from ?? 'today', query.days ?? 2] as const;

export type DneskaiPlanTone = 'neutral' | 'information' | 'success' | 'warning' | 'risk';
/** The colour of a slot's state: waiting for approval is the one the owner acts on. */
export const DNESKAI_PLAN_STATUS_TONES: Record<DneskaiPlanStatus, DneskaiPlanTone> = {
  planned: 'neutral',
  generating: 'information',
  ready: 'warning',
  approved: 'information',
  published: 'success',
  skipped: 'neutral',
  failed: 'risk',
};

/** Whether a day is today, tomorrow or another day of the plan; both dates are Prague calendar days. */
export function dneskaiPlanRelativeDay(date: string, today: string): 'today' | 'tomorrow' | 'other' {
  if (date === today) return 'today';
  const next = new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return date === next ? 'tomorrow' : 'other';
}

/** A caption this long or with this many lines starts collapsed. */
export const DNESKAI_PLAN_LONG_TEXT = { characters: 280, lines: 5 } as const;
export function dneskaiPlanTextIsLong(text: string): boolean {
  return text.length > DNESKAI_PLAN_LONG_TEXT.characters || text.split('\n').length > DNESKAI_PLAN_LONG_TEXT.lines;
}
