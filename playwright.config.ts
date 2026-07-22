import { defineConfig, devices } from "@playwright/test";

const PORT = 3939;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E config. The dev server is booted with placeholder public Supabase env
 * vars — the suites exercise the public login page and the dev-only /dev-preview
 * dashboard harness, neither of which needs a real backend.
 */
export default defineConfig({
  testDir: "./e2e",
  // Cold Next.js dev compilation plus a full axe scan can exceed Playwright's
  // 30 s default on CI and clean developer machines.
  timeout: 90_000,
  fullyParallel: true,
  // Route compilation and axe scans contend heavily when the deterministic
  // preview is cold. One worker avoids duplicate compilation and keeps the
  // same coverage deterministic on smaller machines.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    // Compile once, then run the same production server used after deployment.
    // NEXT_E2E exposes fixture-only /dev-preview for this build and nowhere
    // else; ordinary production builds retain the route's 404 guard.
    command: `npm run build && npx next start -p ${PORT}`,
    url: `${BASE_URL}/dev-preview`,
    reuseExistingServer: !process.env.CI,
    // The production build is the server setup step, not an individual test.
    // Leave test assertions at 90 s while allowing shared/low-core runners to
    // finish the one-time compile before the suite begins.
    timeout: 300_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "preview-anon-key",
      // Hide the dev-tools indicator — it overlaps the sidebar footer and
      // intercepts pointer events in tests.
      NEXT_E2E: "1",
    },
  },
});
