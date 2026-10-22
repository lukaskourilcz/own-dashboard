import { retiredMarketingRoute } from '@/lib/marketing/retired-route';
// Retired (audit finding cost-06). Its last callers were n8n workflows; all are inactive or archived, and the
// pg_cron tick runs DNESKAi. Every method answers 410 before any authentication, body read, database or provider call.
export const GET=retiredMarketingRoute,HEAD=retiredMarketingRoute,POST=retiredMarketingRoute,PUT=retiredMarketingRoute,PATCH=retiredMarketingRoute,DELETE=retiredMarketingRoute,OPTIONS=retiredMarketingRoute;
