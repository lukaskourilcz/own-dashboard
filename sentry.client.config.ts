// Sentry client config. Runs only when NEXT_PUBLIC_SENTRY_DSN is set —
// the helper is a no-op in dev / when DSN is missing, so installs without
// Sentry pay zero runtime cost.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        // Mask everything user-typed by default; record only non-sensitive UI.
        maskAllText: true,
        maskAllInputs: true,
        blockAllMedia: true,
      }),
    ],
    sendDefaultPii: false,
  });
}
