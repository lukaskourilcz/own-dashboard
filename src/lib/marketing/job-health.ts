import { z } from 'zod';
import { MARKETING_PROVIDER_FAILURE_CODES } from './provider-errors';

export const MARKETING_JOB_HEALTH_LIMIT = 10;
const statuses = ['queued', 'running', 'review', 'failed', 'reconciliation', 'unavailable'] as const;
const errors = [...MARKETING_PROVIDER_FAILURE_CODES, 'source-unavailable', 'source-changed', 'template-unapproved', 'template-changed', 'consent-required', 'configuration-required',
  'budget-exceeded', 'copy-validation-failed', 'asset-validation-failed', 'worker-lease-expired', 'worker-fence-lost',
  'calendar-entry-changed', 'calendar-entry-rebound', 'generation-failed'] as const;
export const MarketingJobHealthSchema = z.strictObject({
  id: z.uuid(), status: z.enum(statuses), errorCode: z.enum(errors).nullable(),
  brand: z.enum(['dneskai', 'devshark']).nullable(), createdAt: z.iso.datetime({ offset: true }),
});
export type MarketingJobHealth = z.infer<typeof MarketingJobHealthSchema>;

/** Only projected scalar metadata crosses to the owner UI, including failed jobs with no result. */
export function safeMarketingJobs(rows: unknown[]): Array<MarketingJobHealth & { costUsd: number | null }> {
  return rows.slice(0, 100).flatMap(value => {
    if (!value || typeof value !== 'object') return [];
    const row = value as Record<string, unknown>;
    const parsed = MarketingJobHealthSchema.safeParse({ id: row.id,
      status: statuses.includes(row.status as typeof statuses[number]) ? row.status : 'unavailable',
      errorCode: typeof row.error_code === 'string' && row.error_code ? errors.includes(row.error_code as typeof errors[number]) ? row.error_code : 'generation-failed' : null,
      brand: row.brand === 'dneskai' || row.brand === 'devshark' ? row.brand : null, createdAt: row.created_at });
    if (!parsed.success) return [];
    const amount = typeof row.cost_usd === 'number' ? row.cost_usd : typeof row.cost_usd === 'string' && /^\d+(?:\.\d+)?$/.test(row.cost_usd) ? Number(row.cost_usd) : null;
    return [{ ...parsed.data, costUsd: amount !== null && Number.isFinite(amount) && amount >= 0 ? amount : null }];
  });
}

export function marketingJobHealth(jobs: Array<MarketingJobHealth & { costUsd: number | null }>): MarketingJobHealth[] {
  return jobs.slice(0, MARKETING_JOB_HEALTH_LIMIT).map(({ id, status, errorCode, brand, createdAt }) => ({ id, status, errorCode, brand, createdAt }));
}
