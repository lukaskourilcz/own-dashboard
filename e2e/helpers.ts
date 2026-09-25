import type { Page } from "@playwright/test";

/** console.error / pageerror text we never want to fail a test. */
const BENIGN = [
  "React DevTools",
  "Download the React DevTools",
  "ResizeObserver loop",
  "favicon",
];

/**
 * Collect real console errors + uncaught page errors. Returns a live array;
 * assert it is empty at the end of a test.
 */
export function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!BENIGN.some((b) => text.includes(b))) {
      const source = msg.location().url;
      errors.push(source ? `${text} (${source})` : text);
    }
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Any stray Supabase REST/auth/realtime request resolves to benign data so the
 * fixture harness never surfaces a network error.
 */
export async function stubBackend(page: Page): Promise<void> {
  // External favicons are decorative and must not make fixture tests depend
  // on Google's network availability.
  await page.route("https://www.google.com/s2/favicons?**", route => route.fulfill({
    status: 200,
    contentType: "image/gif",
    body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64"),
  }));
  await page.route("**/api/github/repos", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ repos: [] }),
  }));
  await page.route("**/api/github/activity**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], connected: false }),
  }));
  await page.route(/example\.supabase\.co/, (route) => {
    const url = route.request().url();
    const isCurrentUser = url.includes("/auth/v1/user");
    const isAuth = url.includes("/auth/");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: isCurrentUser
        ? JSON.stringify({ id: "u1", aud: "authenticated", role: "authenticated", email: "jan.novak@example.com", user_metadata: {}, created_at: "2025-01-01T00:00:00Z" })
        : isAuth ? "{}" : "[]",
    });
  });
}

/**
 * Force a deterministic language + theme before any app script runs, stub the
 * backend, and open the dev-only dashboard preview.
 */
export async function gotoPreview(
  page: Page,
  opts: { lang?: "en" | "cs"; theme?: "light" | "dark" } = {},
): Promise<void> {
  const { lang = "en", theme = "light" } = opts;
  // Settle motion instantly so assertions/scans never catch a mid-transition
  // frame (also exercises the reduced-motion path wired via MotionConfig).
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(
    ([l, t]) => {
      try {
        localStorage.setItem("lang", l);
        localStorage.setItem("theme", t);
      } catch {
        /* ignore */
      }
    },
    [lang, theme] as const,
  );
  await stubBackend(page);
  await page.goto("/dev-preview");
}

/**
 * Give the fixture preview a signed-in Supabase session cookie so client
 * writes reach the (stubbed) REST API instead of stopping at "sign in first".
 * Pair it with a page.route() that answers the specific table.
 */
export async function signInFixtureUser(page: Page): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: "u1", exp: expiresAt })).toString("base64url"),
    "test",
  ].join(".");
  await page.context().addCookies([{
    name: "sb-example-auth-token",
    value: "base64-" + Buffer.from(JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: { id: "u1" } })).toString("base64url"),
    url: "http://localhost:3939",
  }]);
}
