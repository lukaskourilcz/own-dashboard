/**
 * The answer of a retired marketing entry point (audit findings cost-06, cost-07). The October n8n
 * orchestration was retired on 2026-10-20 (#113, #120); the pg_cron tick (`POST /api/marketing/tick`) is the
 * only scheduled entry point for DNESKAi. `/api/marketing/dneskai/collect` answers this for every method before
 * anything else runs; `/api/marketing/n8n` answers it for DNESKAi operations before any side effect.
 */
export const MARKETING_ROUTE_RETIRED = { code: 'route-retired' } as const;

export function retiredMarketingRoute(): Response {
 return Response.json(MARKETING_ROUTE_RETIRED, { status: 410, headers: { 'Cache-Control': 'no-store' } });
}
