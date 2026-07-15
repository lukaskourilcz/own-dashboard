import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. Shipped as **Report-Only** first: it emits the
// header and reports violations without blocking anything, so a complex app
// (Supabase realtime, PostHog, Sentry, motion's inline styles, Next's inline
// bootstrap) can't be broken by a too-tight rule. Watch the browser console /
// a report endpoint for a few days, then flip the key to
// `Content-Security-Policy` (enforcing) once it's clean — see NEEDED.md.
//
// connect-src lists only what the BROWSER calls directly (server-side fetches —
// Jina, Firecrawl, Google, Resend — are not subject to page CSP).
const csp = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  [
    "connect-src 'self'",
    "https://*.supabase.co wss://*.supabase.co",
    "https://*.posthog.com https://*.i.posthog.com",
    "https://*.sentry.io https://*.ingest.sentry.io",
    "https://api.frankfurter.dev https://api.frankfurter.app",
  ].join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "upgrade-insecure-requests",
].join("; ");

// Enforcing headers (these are safe to enforce immediately).
const securityHeaders = [
  { key: "Content-Security-Policy-Report-Only", value: csp },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

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
