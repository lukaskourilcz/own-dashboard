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
    if (!BENIGN.some((b) => text.includes(b))) errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

/**
 * Any stray Supabase REST/auth/realtime request resolves to benign data so the
 * fixture harness never surfaces a network error.
 */
export async function stubBackend(page: Page): Promise<void> {
  await page.route(/example\.supabase\.co/, (route) => {
    const isAuth = route.request().url().includes("/auth/");
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: isAuth ? "{}" : "[]",
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
