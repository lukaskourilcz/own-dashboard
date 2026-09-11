import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview } from "./helpers";

test("resource library supports compact cards, filters, keyboard disclosure and edit/delete dialogs", async ({page}, info) => {
  test.skip(info.project.name !== "desktop", "one six-width matrix");
  for (const width of [360,430,768,1024,1440,1728]) {
    const cs=width!==1440;
    await page.setViewportSize({width,height:1000});
    await gotoPreview(page,{lang:cs?"cs":"en",theme:width===1024?"dark":"light"});
    if(width<768) {
      await page.getByRole("button",{name:cs?"Více":"More",exact:true}).click();
      await page.getByRole("dialog").getByRole("button",{name:cs?"Odkazy":"Links",exact:true}).click();
    } else await page.locator("aside").getByRole("button",{name:cs?"Odkazy":"Links",exact:true}).click();
    const card=page.locator('[data-link-card="al1"]');
    const toggle=card.getByRole("button",{name:/Midjourney/}).first();
    await expect(toggle).toHaveAttribute("aria-expanded","false");
    await expect(card.getByText("AI image generation for moodboards and concepts.")).toBeHidden();
    await expect(card.getByRole("button",{name:`${cs?"Upravit":"Edit"}: Midjourney`,exact:true})).toBeVisible();
    await expect(card.getByRole("link").first()).toHaveAttribute("href","https://www.midjourney.com");
    await toggle.focus(); await page.keyboard.press("Enter");
    await expect(toggle).toHaveAttribute("aria-expanded","true");
    await expect(card.getByText("AI image generation for moodboards and concepts.")).toBeVisible();
    await page.getByRole("button",{name:cs?"Sbalit vše":"Collapse all",exact:true}).click();
    await page.getByRole("combobox",{name:cs?"Cena":"Pricing",exact:true}).click();
    await page.getByRole("option",{name:cs?"Plně zdarma":"Fully free",exact:true}).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('[data-link-card="al2"]')).toBeVisible();
    await page.getByRole("textbox",{name:cs?"Hledat odkazy…":"Search links…",exact:true}).fill("no matching resource");
    await expect(page.getByText(cs?"Žádné výsledky":"No matches",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:cs?"Zrušit filtry":"Clear filters",exact:true}).click();
    await card.getByRole("button",{name:`${cs?"Upravit":"Edit"}: Midjourney`,exact:true}).click();
    await expect(page.getByRole("dialog").getByLabel(cs?"Název":"Name",{exact:true})).toHaveValue("Midjourney");
    await page.keyboard.press("Escape");
    await card.getByRole("button",{name:`${cs?"Smazat odkaz":"Delete link"}: Midjourney`,exact:true}).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:cs?"Rozbalit vše":"Expand all",exact:true}).click();
    await expect(page.locator('[data-link-card="al3"]').getByRole("link",{name:"https://example.com/resources/a-long-reference-path-for-checking-readable-expanded-library-cards-on-narrow-screens",exact:true})).toBeVisible();
    expect((await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page']}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze()).violations,`${width}px`).toEqual([]);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
    await page.screenshot({path:`test-results/link-library-expanded-${width}.png`,fullPage:true});
    await page.getByRole("button",{name:cs?"Sbalit vše":"Collapse all",exact:true}).click();
    await page.screenshot({path:`test-results/link-library-${width}.png`,fullPage:true});
  }
});
