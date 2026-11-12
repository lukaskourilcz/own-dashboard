import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

type AxePage = ConstructorParameters<typeof AxeBuilder>[0]["page"];

async function openOpportunities(page: Page, cs: boolean, width: number) {
  const name = cs ? "Příležitosti" : "Opportunities";
  if (width < 768) {
    await page.getByRole("button", { name: cs ? "Více" : "More", exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name, exact: true }).click();
  } else await page.locator("aside").getByRole("button", { name, exact: true }).click();
}

const noOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("Opportunities lists contacts, filters them and fills the template, at every supported width", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one responsive matrix");
  for (const width of [360, 430, 768, 1024, 1440, 1728]) {
    const cs = width !== 1440;
    await page.setViewportSize({ width, height: 1000 });
    await gotoPreview(page, { lang: cs ? "cs" : "en", theme: width === 1024 ? "dark" : "light" });
    await openOpportunities(page, cs, width);
    await expect(page.getByTestId("opportunities-panel")).toBeVisible();
    await expect(page.getByRole("combobox", { name: cs ? "Obor" : "Trade" })).toHaveText(/Hodinový manžel/);
    const visible = page.locator(width < 1280 ? "ul[aria-label]" : "table").first();
    await expect(visible.getByRole("button", { name: cs ? "Detail: Kutil Praha" : "Details of Kutil Praha" })).toBeVisible();
    // "Do not contact" is hidden by the default "still open" filter.
    await expect(visible.getByText("Martin Král")).toHaveCount(0);
    expect((await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations, `${width}px`).toEqual([]);
    expect(await noOverflow(page), `${width}px`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/leads-contacts-${width}.png`, fullPage: true });

    await visible.getByRole("button", { name: cs ? "Napsat: Opravy Dvořák" : "Write to Opravy Dvořák" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByTestId("lead-compose-subject")).toHaveText("Opravy Dvořák: web s objednáním termínu");
    await expect(dialog.getByTestId("lead-compose-body")).toContainText("Vlastní web jsem k vám nenašel.");
    await expect(dialog.getByRole("link", { name: cs ? "Otevřít v poště" : "Open in mail" })).toHaveAttribute("href", /^mailto:opravy\.dvorak@example\.com\?subject=/);
    expect(await noOverflow(page), `${width}px dialog`).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `test-results/leads-compose-${width}.png`, fullPage: true });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  }
});

test("Contacts filter by website and region, change status, and Emails edits the template", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "covered once on desktop");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await gotoPreview(page, { lang: "cs" });
  await openOpportunities(page, true, 1440);
  const table = page.locator("table");

  await page.getByRole("combobox", { name: "Web" }).click();
  await page.getByRole("option", { name: "Bez webu", exact: true }).click();
  await expect(table.getByRole("button", { name: /^Detail: / })).toHaveCount(2);
  await expect(table.getByText("Bez webu").first()).toBeAttached();

  await page.getByRole("combobox", { name: "Kraj" }).click();
  await page.getByRole("option", { name: "Jihomoravský kraj", exact: true }).click();
  await expect(table.getByRole("button", { name: /^Detail: / })).toHaveCount(1);
  await page.getByRole("button", { name: "Zrušit filtry" }).click();
  await expect(table.getByRole("button", { name: /^Detail: / })).toHaveCount(5);

  await page.getByRole("combobox", { name: "Řazení" }).click();
  await page.getByRole("option", { name: "Kvalita webu, nejhorší první" }).click();
  await expect(table.locator("tbody tr").first()).toContainText("Údržba Hora");

  await page.getByRole("combobox", { name: "Oslovení: Opravy Dvořák" }).click();
  await page.getByRole("option", { name: "Osloven", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Oslovení: Opravy Dvořák" })).toHaveText("Osloven");

  await page.getByRole("button", { name: "Detail: Opravy Dvořák" }).click();
  await expect(page.getByRole("dialog")).toContainText("Naposledy osloven");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Emaily", exact: true }).click();
  const subject = page.getByLabel("Předmět");
  await subject.fill("{{jmeno}} a {{neznama}}");
  await expect(page.getByText(/^Neznámé proměnné: /)).toContainText("{{neznama}}");
  await expect(page.getByTestId("lead-template-preview-subject")).toHaveText(/^Jan Novák – hodinový manžel a$/);
  await subject.fill("Web pro {{jmeno}}");
  await page.getByRole("button", { name: "Uložit šablonu" }).click();
  await expect(page.getByText("Uloženo", { exact: false }).first()).toBeVisible();
  expect((await new AxeBuilder({ page: page as unknown as AxePage }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: "test-results/leads-emails-1440.png", fullPage: true });

  await page.getByRole("button", { name: "Kontakty", exact: true }).click();
  await page.getByRole("button", { name: "Napsat: Kutil Praha" }).click();
  await expect(page.getByTestId("lead-compose-subject")).toHaveText("Web pro Kutil Praha");
  await expect(page.getByTestId("lead-compose-body")).toContainText("Prošel jsem si váš web kutil-praha.example.cz. Čistý web s ceníkem");
});
