import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

const isDev = process.env.NODE_ENV !== "production";

// Content-Security-Policy. Now **enforcing** — the live console was verified
// clean of Report-Only violations before the flip. It covers the app's real
// surface (Supabase realtime, PostHog, Sentry, motion's inline styles, Next's
// inline bootstrap). If you ever add a third-party host, extend the relevant
// directive below (connect-src for fetch/ws, img-src for images, script-src
// for scripts) — a blocked resource now actually fails, so watch for it.
//
// connect-src lists only what the BROWSER calls directly (server-side fetches —
// Jina, Anthropic, Google, Resend — are not subject to page CSP).
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
  "media-src 'self' https://*.supabase.co",
  [
    "connect-src 'self'",
    "https://*.supabase.co wss://*.supabase.co",
    "https://*.posthog.com https://*.i.posthog.com",
    "https://*.sentry.io https://*.ingest.sentry.io",
    "https://api.frankfurter.dev https://api.frankfurter.app",
  ].join(" "),
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  // Now enforcing, so this is active: transparently upgrade any http
  // subresource to https instead of blocking it. (Ignored under Report-Only,
  // which is why it was held back until the flip.)
  "upgrade-insecure-requests",
].join("; ");

// Enforcing headers.
const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
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

// The vendored carousel studio (vendor/carousel-studio, own-dashboard#117) reads its fonts and
// brand kit through a path derived from its own module URL. Its node_modules entry is a link into
// vendor/, so Turbopack bundles it as project code and rewrites that URL to the project-relative
// vendor/carousel-studio/dist path at run time. No bundler follows the reads themselves, so these
// globs put the files at that path in every marketing function that can render a DNESKAi slide.
// Without them the deployed rasteriser finds no fonts (system fonts are switched off), which is
// how Quorum's render route answered 500 in production.
const carouselStudioFiles = ["./vendor/carousel-studio/fonts/**/*", "./vendor/carousel-studio/brand-kits/**/*"];
// The trace keeps sharp's native addon but drops the libvips library it links against, and sharp
// then fails to load (docs/marketing-render-preflight.md). Every marketing function that can reach
// sharp (the job runner, the scheduled tick, revisions, media collection, offline import) gets it.
const sharpLibvips = "./node_modules/@img/sharp-libvips-*/lib/**/*";

const nextConfig: NextConfig = {
  // Production checks all application inputs. Root validation also checks tests and scripts.
  typescript: { tsconfigPath: isDev ? 'tsconfig.json' : 'tsconfig.app.json' },
  // Native bindings loaded through platform-suffixed specifiers no bundler can resolve.
  serverExternalPackages: ["sharp", "@resvg/resvg-js", "ffmpeg-static"],
  // Marketing file reads use templates, vendored fonts/kits and generated
  // temporary files. The compiler can conservatively trace the repository for
  // dynamic paths; build/test/source files are not runtime assets. Keep the
  // fixture-only dev-preview routes separate: they read public demo images.
  outputFileTracingExcludes: {
    "/api/marketing/**": [
      "./docs/**/*", "./tests/**/*", "./e2e/**/*", "./src/**/*", "./services/**/*",
      "./supabase/**/*", "./media/**/*", "./public/**/*", "./scripts/**/*",
      "./.claude/**/*", "./.agents/**/*", "./.github/**/*", "./.vercel/**/*",
      "./skill-observations/**/*", "./.env*", "./*.md", "./*.html",
      "./tsconfig.tsbuildinfo", "./vitest.config.mts", "./playwright.config.ts", "./package-lock.json",
    ],
  },
  outputFileTracingIncludes: {
    "/api/marketing/jobs/*/execute": ["./templates/marketing/fonts/**/*.ttf", "./templates/marketing/*/*.svg", "./templates/marketing/claude-design/**/assets/*.svg"],
    "/api/marketing/n8n": ["./templates/marketing/fonts/**/*.ttf", "./templates/marketing/*/*.svg", "./templates/marketing/claude-design/**/assets/*.svg"],
    "/api/marketing/**": [...carouselStudioFiles, sharpLibvips],
    // The reel renderer (#163) spawns the ffmpeg-static executable, which no import reaches.
    "/api/marketing/dneskai/render-reel": ["./node_modules/ffmpeg-static/ffmpeg"],
    // The audio library (#164) measures each upload with the same binary.
    "/api/marketing/dneskai/audio": ["./node_modules/ffmpeg-static/ffmpeg"],
    // The Design Lab's fixture-only fit route runs the same studio fitter as /api/marketing/dneskai/fit.
    "/api/dev-preview/dneskai-fit": [...carouselStudioFiles, sharpLibvips],
    "/api/dev-preview/dneskai-render": [...carouselStudioFiles, sharpLibvips, "./public/demo/dneskai/original-*.jpg"],
    "/api/dev-preview/dneskai-preview": [...carouselStudioFiles, sharpLibvips, "./public/demo/dneskai/original-*.jpg"],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // The dev-tools indicator floats over the sidebar footer and intercepts
  // clicks in Playwright runs; the E2E server (playwright.config.ts) sets
  // NEXT_E2E=1 to hide it. Normal `next dev` keeps the indicator.
  ...(process.env.NEXT_E2E ? { devIndicators: false as const } : {}),
};

// Runtime initialization is optional in the native instrumentation files.
// The build wrapper adds source-map/instrumentation support when configured;
// import its config-only entry so reading Next config does not load the runtime SDK.
const wantsSentry =
  !!(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) &&
  !!process.env.SENTRY_ORG &&
  !!process.env.SENTRY_PROJECT;

export default wantsSentry
  ? withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      silent: true,
      widenClientFileUpload: true,
      // Direct ingestion is already allowed by CSP; avoid a Vercel relay and auth redirect.
      telemetry: false,
      webpack: { treeshake: { removeDebugLogging: true } },
    })
  : nextConfig;
