import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { gotoPreview, watchConsole, signInFixtureUser } from "./helpers";

test.use({ timezoneId: "America/Los_Angeles" });
test("workspace tabs support keyboard navigation and communication uses local time", async ({page}) => {
 const errors=watchConsole(page);
 await gotoPreview(page);
 await page.goto("/dev-preview?tab=projects");
 await page.locator("#main-content").getByRole("link",{name:"Acme customer portal",exact:true}).first().click();
 const tabs=page.getByRole("tablist",{name:"Project workspace"});
 const selected=tabs.getByRole("tab",{selected:true});
 await selected.focus();await page.keyboard.press("End");
 await expect(tabs.getByRole("tab").last()).toBeFocused();
 await page.keyboard.press("Home");await expect(tabs.getByRole("tab").first()).toBeFocused();
 await page.keyboard.press("ArrowRight");await expect(tabs.getByRole("tab").nth(1)).toBeFocused();
 await page.keyboard.press("Enter");await expect(tabs.getByRole("tab").nth(1)).toHaveAttribute("aria-selected","true");
 const panel=page.getByRole("tabpanel");await expect(panel).toBeVisible();
 await page.goto("/dev-preview?tab=projects");
 await page.locator("#main-content").getByRole("link",{name:"DNESKAi",exact:true}).first().click();
 await page.getByTestId("dneskai-more").click();
 await page.getByTestId("dneskai-more-menu").getByRole("button",{name:"Communication",exact:true}).click();
 await expect(page.locator("#communication-date")).not.toHaveValue("");
 const times=panel.locator("time");
 expect(await times.count()).toBeGreaterThan(0);
 for(const time of await times.all()) {
   const instant=await time.getAttribute("datetime");
   const expected=await page.evaluate(value => { const d=new Date(value!);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;},instant);
   await expect(time).toHaveText(expected);
 }
 const axe=await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"]}).include("#main-content").withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
 expect(axe.violations).toEqual([]);expect(errors).toEqual([]);
 expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1)).toBe(true);
});

test("project cron forms expose named controls and reject malformed project URLs",async ({page}) => {
 await gotoPreview(page);await page.goto("/dev-preview?tab=projects");
 await page.getByRole("button",{name:"Add project",exact:true}).click();
 await page.getByLabel("Name",{exact:true}).fill("Audit fixture");
 const url=page.locator("#proj-url");await url.fill("javascript:alert(1)");
 await page.getByRole("dialog").getByRole("button",{name:"Add",exact:true}).click();
 expect(await url.evaluate(node => (node as HTMLInputElement).validity.valid)).toBe(false);
 await page.keyboard.press("Escape");
 await page.locator("#main-content").getByRole("button",{name:"Manage operations",exact:true}).first().click();
 await page.getByRole("button",{name:"Add cron",exact:true}).click();
 await expect(page.getByRole("textbox",{name:"Name",exact:true})).toBeVisible();
 await expect(page.getByRole("textbox",{name:"Schedule",exact:true})).toBeVisible();
 const axe=await new AxeBuilder({page:page as unknown as ConstructorParameters<typeof AxeBuilder>[0]["page"]}).include('[role="dialog"]').withTags(["wcag2a","wcag2aa","wcag21aa","wcag22aa"]).analyze();
 expect(axe.violations).toEqual([]);
});


test("closing project operations flushes a note edit before its debounce expires",async ({page}) => {
 await gotoPreview(page);await signInFixtureUser(page);await page.goto("/dev-preview?tab=projects");
 const writes:Array<{notes?:string}>=[];
 await page.route("**/rest/v1/projects**",async route => {
   if(route.request().method()==="PATCH"){writes.push(route.request().postDataJSON());await route.fulfill({status:204,body:""});}
   else await route.fulfill({status:200,contentType:"application/json",body:"[]"});
 });
 await page.locator("#main-content").getByRole("button",{name:"Manage operations",exact:true}).first().click();
 const editor=page.getByRole("dialog").locator('.tiptap[contenteditable="true"]');
 await editor.fill("Quick edit retained after closing");
 await page.keyboard.press("Escape");
 await expect(page.getByRole("dialog")).toBeHidden();
 await expect.poll(()=>writes.some(row => row.notes?.includes("Quick edit retained after closing"))).toBe(true);
});
