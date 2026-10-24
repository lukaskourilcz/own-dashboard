import { sentryPrivacyOptions } from "./src/lib/sentry-privacy";
import { redactTelemetryUrl } from "./src/lib/telemetry-url";

type ClientSdk = typeof import("@sentry/nextjs");
let sdk: Promise<ClientSdk | null> = Promise.resolve(null);
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
if (dsn) {
  sdk = import("@sentry/nextjs").then(sentry => {
    sentry.init({ dsn, tracesSampleRate: 0.1, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0, ...sentryPrivacyOptions });
    return sentry;
  }).catch(() => null);
}

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  void sdk.then(sentry => sentry?.captureRouterTransitionStart(redactTelemetryUrl(url), navigationType)).catch(() => undefined);
}
