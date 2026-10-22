import { retiredMarketingRoute } from '@/lib/marketing/retired-route';
// Retired (audit finding cost-06): the pg_cron tick runs DNESKAi collection. Every method answers 410 before any
// authentication, body read, database or provider call.
export const GET=retiredMarketingRoute,HEAD=retiredMarketingRoute,POST=retiredMarketingRoute,PUT=retiredMarketingRoute,PATCH=retiredMarketingRoute,DELETE=retiredMarketingRoute,OPTIONS=retiredMarketingRoute;
