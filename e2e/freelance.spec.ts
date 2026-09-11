import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

test("opportunity profiles and proposal review work in both languages and supported widths", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one responsive matrix");
  for (const width of [360,430,768,1024,1440,1728]) {
    const cs = width !== 1440;
    await page.setViewportSize({width,height:1000});
    await gotoPreview(page,{lang:cs ? "cs" : "en",theme:width === 1024 ? "dark" : "light"});
    if(width < 768) {
      await page.getByRole("button",{name:cs ? "Více" : "More",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:cs ? "Příležitosti" : "Opportunities",exact:true}).click();
    } else await page.locator("aside").getByRole("button",{name:cs ? "Příležitosti" : "Opportunities",exact:true}).click();
    await page.getByRole("button",{name:cs ? "Detail a odpověď" : "Details & proposal",exact:true}).click();
    const detail = page.getByRole("dialog");
    await expect(detail.getByLabel(cs ? "Návrh odpovědi klientovi" : "Proposal draft")).toBeVisible();
    await detail.getByLabel(cs ? "První odpověď klienta dne" : "First client reply on").fill("2026-09-01");
    await expect(detail.getByRole("alert")).toBeVisible();
    await detail.getByRole("button",{name:cs ? "Zavřít" : "Close",exact:true}).first().click();
    await page.getByRole("button",{name:cs ? "Platformy a profily" : "Platforms & profiles",exact:true}).click();
    await expect(page.getByRole("link",{name:cs ? "Hledat zakázky" : "Find projects",exact:true})).toHaveAttribute("href","https://www.upwork.com/freelance-jobs/react-js/");
    await page.getByRole("button",{name:cs ? "Profil a služby" : "Profile & services",exact:true}).click();
    await expect(page.getByRole("dialog").getByLabel(cs ? "Text profilu" : "Profile text")).toHaveValue("React, TypeScript and Node.js application development.");
    expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations,`${width}px`).toEqual([]);
    await page.screenshot({path:`test-results/freelance-profile-${width}.png`,fullPage:true});
    await page.getByRole("dialog").getByRole("button",{name:cs ? "Zavřít" : "Close",exact:true}).first().click();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth),`${width}px`).toBeLessThanOrEqual(1);
    await page.screenshot({path:`test-results/freelance-platforms-${width}.png`,fullPage:true});
  }
});
