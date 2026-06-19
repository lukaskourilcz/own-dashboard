import { test, expect } from "@playwright/test";
import { stubBackend, watchConsole } from "./helpers";

// Runs on both the desktop and mobile projects, so this also covers responsive
// rendering of the public login page.
test.describe("login", () => {
  test("renders with an accessible, enabled sign-in button and no console errors", async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await stubBackend(page);
    await page.goto("/login");

    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

    const signIn = page.getByRole("button", { name: /google/i });
    await expect(signIn).toBeVisible();
    await expect(signIn).toBeEnabled();

    // Nothing should overflow the viewport horizontally.
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);

    expect(errors, errors.join("\n")).toEqual([]);
  });
});
