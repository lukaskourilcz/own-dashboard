import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {};

// withSentryConfig is no-op when SENTRY_DSN is missing at runtime, but
// it does require SENTRY_ORG / SENTRY_PROJECT for source-map upload at
// build-time. We only wrap when those are set so local builds without
// Sentry stay fast.
const wantsSentry =
  !!process.env.SENTRY_DSN &&
  !!process.env.SENTRY_ORG &&
  !!process.env.SENTRY_PROJECT;

export default wantsSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      tunnelRoute: "/monitoring",
      disableLogger: true,
    })
  : nextConfig;
