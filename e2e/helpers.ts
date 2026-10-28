import { user as demoUser } from "../src/lib/demo/fixtures";
import type { BankProviderState } from "../src/lib/bank/flow";
import type { Page } from "@playwright/test";
import type { GithubRepo } from "../src/lib/github";

/** The same validated metadata serves recent lists and direct project reads. */
export async function stubGithubRepositories(page: Page, repos: GithubRepo[], hasMore = false) {
  await page.route("**/api/github/repos", route => route.fulfill({ json: { repos, hasMore } }));
  await page.route("**/api/github/repos/lookup?**", route => {
    const name = new URL(route.request().url()).searchParams.get("repo")?.toLowerCase();
    const repo = repos.find(row => row.full_name.toLowerCase() === name);
    return route.fulfill(repo ? { json: { id: repo.id, full_name: repo.full_name, repo } } : { status: 404, json: { error: "Fixture repository not visible" } });
  });
}

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
  // Opt-in diagnostics preserve the normal error assertion; never filter the warning.
  if (process.env.AUDIT_REACT_STACK === '1') {
    void page.context().newCDPSession(page).then(async session => {
      session.on('Runtime.consoleAPICalled', (event: { args?: Array<{ value?: unknown }>; stackTrace?: { callFrames: Array<{ functionName: string; url: string; lineNumber: number }> } }) => {
        if (event.args?.some(arg => typeof arg.value === 'string' && arg.value.includes("hasn't mounted yet"))) {
          console.warn('REACT_PRE_MOUNT_STACK\n' + (event.stackTrace?.callFrames ?? []).map(frame => `${frame.functionName} (${frame.url}:${frame.lineNumber + 1})`).join('\n'));
        }
      });
      await session.send('Runtime.enable');
    }).catch(() => undefined); // Other browser engines retain the ordinary console check.
  }
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

/** Complete invented status contract; never reads a signed-in account. */
export function integrationStatusFixture(providers: BankProviderState[] = []) {
  return { google: { configured: false, connected: false }, github: { configured: false, connected: false },
    bank: { configured: providers.some(provider => provider.configured), connected: providers.some(provider => provider.connected), last_synced_at: null, providers }, email: { configured: false } };
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
  await page.route("**/api/integrations/status", route => route.fulfill({
    status: 200, contentType: "application/json",
    body: JSON.stringify(integrationStatusFixture()),
  }));
  await page.route("**/api/github/repos", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ repos: [], hasMore: false }),
  }));
  await page.route("**/api/github/repos/lookup?**", route => route.fulfill({ status: 401, json: { reason: "no-token" } }));
  await page.route("**/api/github/needed", route => route.fulfill({ json: { kind: "ok", files: (route.request().postDataJSON().repos as { id: number }[]).map(repo => ({ repoId: String(repo.id), result: { kind: "not-found" } })) } }));
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
      ...(url.includes("/rest/v1/bank_connections") ? { headers: { "access-control-expose-headers": "content-range", "content-range": "*/0" } } : {}),
      body: url.includes("/rpc/transaction_rule_context") ? JSON.stringify({ owner_id: demoUser.id, rules: [], rules_version: "0123456789abcdef0123456789abcdef", project_ids: [], subscription_ids: [] }) : isCurrentUser
        ? JSON.stringify({ id: demoUser.id, aud: "authenticated", role: "authenticated", email: "jan.novak@example.com", user_metadata: {}, created_at: "2025-01-01T00:00:00Z" })
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
export async function signInFixtureUser(page: Page, ownerId = demoUser.id): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const token = [
    Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify({ sub: ownerId, exp: expiresAt })).toString("base64url"),
    "test",
  ].join(".");
  await page.context().addCookies([{
    name: "sb-example-auth-token",
    value: "base64-" + Buffer.from(JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_at: expiresAt, expires_in: 3600, user: { id: ownerId } })).toString("base64url"),
    url: "http://localhost:3939",
  }]);
}
