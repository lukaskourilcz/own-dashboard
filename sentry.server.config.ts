import * as Sentry from "@sentry/nextjs";
import { sentryPrivacyOptions } from "./src/lib/sentry-privacy";
const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) Sentry.init({ dsn, tracesSampleRate: 0.1, ...sentryPrivacyOptions });
