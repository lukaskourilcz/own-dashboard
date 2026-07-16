import { defineConfig, devices } from "@playwright/test";

const PORT = 3939;
const BASE_URL = `http://localhost:${PORT}`;

/**
 * E2E config. The dev server is booted with placeholder public Supabase env
 * vars — the suites exercise the public login page and the dev-only /__preview
 * dashboard harness, neither of which needs a real backend.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
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
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "preview-anon-key",
      // Hide the dev-tools indicator — it overlaps the sidebar footer and
      // intercepts pointer events in tests.
      NEXT_E2E: "1",
    },
  },
});
