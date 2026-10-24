import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { watchConsole } from "./helpers";
import { guest } from "../src/lib/i18n/sections/guest";
import { nav } from "../src/lib/i18n/sections/nav";
import { settings } from "../src/lib/i18n/sections/settings";
import { professional } from "../src/lib/i18n/sections/professional";
const csUrl = "https://docs.google.com/document/d/synthetic-owner-cs/edit", enUrl = "https://docs.google.com/document/d/synthetic-owner-en/edit";
async function open(page: Page, lang: "en" | "cs", destination: "settings" | "opportunities") {
  const label = destination === "settings" ? settings[lang].title : professional[lang].opportunitiesTitle;
  if ((page.viewportSize()?.width ?? 1440) < 768) {
    await page.getByTestId("mobile-nav").getByRole("button", { name: nav[lang].more, exact: true }).click();
    await page.getByRole("dialog").getByRole("button", { name: label, exact: true }).click();
  } else await page.locator("aside").getByRole("button", { name: label, exact: true }).click();
}
for (const lang of ["en", "cs"] as const) {
  test(`${lang}: guest preferences and load metadata stay separate while the notice leaves navigation usable`, async ({ page }) => {
    const errors = watchConsole(page), live: string[] = [];
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript(({ lang, csUrl, enUrl }) => {
      localStorage.setItem("lang",lang); localStorage.setItem("theme",lang === "cs" ? "dark" : "light");
      localStorage.setItem("cvUrlCs",csUrl);localStorage.setItem("cvUrlEn",enUrl);localStorage.setItem("showCzechCareer","1");
      sessionStorage.setItem("on-demand-load:opportunities",JSON.stringify({ at:"2026-10-24T10:00:00.000Z",counts:{ opportunities:98765,platforms:43210 } }));
      sessionStorage.setItem("on-demand-load:owner:synthetic-owner:opportunities",JSON.stringify({ at:"2026-10-24T10:00:00.000Z",counts:{ opportunities:87654,platforms:32109 } }));
    }, { lang, csUrl, enUrl });
    await page.route("**/api/**", route => { live.push(route.request().url()); return route.fulfill({ json: {} }); });
    await page.route(/example\.supabase\.co/, route => { live.push(route.request().url()); return route.fulfill({ json: [] }); });
    await page.route("https://www.google.com/s2/favicons?**", route => route.fulfill({ contentType:"image/gif",body:Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7","base64") }));
    await page.goto(`/guest?lang=${lang}`,{waitUntil:"domcontentloaded"});
    await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.guestTour)).toBe("true");
    const notice = page.getByRole("status").filter({hasText:guest[lang].description}); await expect(notice).toBeVisible();
    await open(page,lang,"settings"); await expect(page.locator("#cv-cs")).toBeVisible(); await expect(page.locator("#cv-cs")).toHaveValue(""); await expect(page.locator("#cv-en")).toHaveValue("");
    const tourUrl = "https://docs.google.com/document/d/synthetic-tour/edit"; await page.locator("#cv-cs").fill(tourUrl); await page.locator("#cv-en").focus();
    expect(await page.evaluate(()=>[localStorage.getItem("cvUrlCs"),localStorage.getItem("cvUrlEn"),localStorage.getItem("showCzechCareer")])).toEqual([csUrl,enUrl,"1"]);
    await open(page,lang,"opportunities"); await expect(page.getByRole("heading",{name:professional[lang].opportunitiesGateTitle,exact:true})).toBeVisible();
    await expect(page.getByText(professional[lang].notLoadedThisSession,{exact:true})).toBeVisible(); await expect(page.locator("body")).not.toContainText("98765");await expect(page.locator("body")).not.toContainText("87654");
    await page.getByRole("button",{name:lang === "cs" ? "Zkontrolovat nové nabídky" : "Check for new offers",exact:true}).click();
    await expect.poll(()=>page.evaluate(()=>sessionStorage.getItem("on-demand-load:preview:opportunities")!==null)).toBe(true);
    await open(page,lang,"settings");await expect(page.locator("#cv-cs")).toHaveValue(tourUrl);
    for(const width of [360,430,600,767,768,1024,1440,1728]) {
      await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
      const close=notice.getByRole("button",{name:guest[lang].dismiss,exact:true}), signIn=notice.getByRole("link",{name:guest[lang].signIn,exact:true});
      for(const control of [close,signIn]) await expect.poll(async()=>(await control.boundingBox())!.height).toBeGreaterThanOrEqual(width<768?44:32);
      if(lang === "cs" && (width === 360 || width === 1440)) await notice.screenshot({path:`/tmp/app-audit-guest-notice-cs-${width}.png`});
      if(width<768) {const banner=await notice.boundingBox(),bar=await page.getByTestId("mobile-nav").boundingBox();expect(banner!.y+banner!.height).toBeLessThanOrEqual(bar!.y-7);}
    }
    expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"]}).include('[role="status"]').withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze()).violations).toEqual([]);
    await notice.getByRole("button",{name:guest[lang].dismiss,exact:true}).click();await expect(notice).toHaveCount(0);
    expect(live).toEqual([]);expect(errors).toEqual([]);
    // A new document/tour discards the previous memory without touching the
    // stored owner values or carrying the tour URL into another instance.
    await page.goto(`/guest?lang=${lang}`);await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.guestTour)).toBe("true");await open(page,lang,"settings");await expect(page.locator("#cv-cs")).toHaveValue("");
    expect(await page.evaluate(()=>[localStorage.getItem("cvUrlCs"),localStorage.getItem("cvUrlEn")])).toEqual([csUrl,enUrl]);
  });
}
