import { test, expect } from "@playwright/test";
import { gotoPreview } from "./helpers";

test.describe("system surfaces", () => {
  test("publishes an installable manifest and app icon", async ({ request }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "validate public resources once");

    const manifestResponse = await request.get("/manifest.webmanifest");
    expect(manifestResponse.ok()).toBe(true);
    expect(manifestResponse.headers()["content-type"]).toContain("application/manifest+json");
    const manifest = await manifestResponse.json();
    expect(manifest).toMatchObject({
      name: "OwnDashboard",
      start_url: "/",
      scope: "/",
      display: "standalone",
    });
    expect(manifest.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: "/icon", purpose: "any" }),
        expect.objectContaining({ src: "/icon", purpose: "maskable" }),
      ]),
    );

    const iconResponse = await request.get("/icon");
    expect(iconResponse.ok()).toBe(true);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
    expect((await iconResponse.body()).byteLength).toBeGreaterThan(1_000);
  });

  test("keeps the Czech invoice isolated on one A4 page in dark mode", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "validate print output once");
    await gotoPreview(page, { theme: "dark" });
    await page.locator("aside nav").getByRole("button", { name: "Invoices", exact: true }).click();
    await page.getByText("2026001", { exact: true }).click();

    const paper = page.locator(".invoice-print-area");
    await expect(paper).toBeVisible();
    await expect(paper).toContainText("Acme s.r.o.");
    await expect(paper.locator("svg")).toHaveCount(1);
    expect(await paper.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");

    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await expect(page.locator("aside")).toBeHidden();
    await expect(paper).toBeVisible();
    const printStyles = await paper.evaluate((element) => {
      const styles = getComputedStyle(element);
      return { position: styles.position, border: styles.borderTopStyle, shadow: styles.boxShadow };
    });
    expect(printStyles).toEqual({ position: "absolute", border: "none", shadow: "none" });

    const pdf = await page.pdf({ format: "A4", printBackground: true });
    expect(pdf.byteLength).toBeGreaterThan(10_000);
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(pdf) });
    const document = await loadingTask.promise;
    expect(document.numPages).toBe(1);
    await loadingTask.destroy();
  });
});
