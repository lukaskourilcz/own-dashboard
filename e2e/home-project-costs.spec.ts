import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { gotoPreview, watchConsole } from './helpers';
type AxePage = ConstructorParameters<typeof AxeBuilder>[0]['page'];
for (const lang of ['cs','en'] as const) {
  test(`Execution queues, JA / AI and project cost evidence reflow (${lang})`,async ({page},info) => {
    test.skip(info.project.name==='mobile','The desktop Chrome project exercises all six responsive widths.');
    const errors=watchConsole(page); const calls:string[]=[];
    page.on('request',r=>{if(r.url().includes('/api/finances/operating-costs'))calls.push(r.url());});
    await gotoPreview(page,{lang,theme:lang==='cs'?'dark':'light'});
    const home=page.getByTestId('execution-home');
    await expect(home.getByRole('list').first().getByRole('listitem')).toHaveCount(5);
    await expect(home.getByRole('list').nth(1).getByRole('listitem')).toHaveCount(1);
    await expect(page.getByRole('heading',{level:1})).toHaveCount(1);
    for(const width of [360,430,768,1024,1440,1728]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    }
    expect((await new AxeBuilder({page:page as unknown as AxePage}).include('[data-testid="execution-home"]').analyze()).violations).toEqual([]);
    await page.screenshot({path:`test-results/home-${lang}.png`});
    await page.goto('/dev-preview?tab=tasks');
    const backlog=page.getByTestId('backlog-panel');
    await expect(backlog.getByRole('listitem')).toHaveCount(4);
    const owner=backlog.getByRole('combobox',{name:lang==='cs'?'Pro':'For',exact:true});
    await owner.click(); await page.getByRole('option',{name:'JA',exact:true}).click();
    await expect(backlog.getByRole('listitem')).toHaveCount(2);
    await owner.click(); await page.getByRole('option',{name:'AI',exact:true}).click();
    await expect(backlog.getByRole('listitem')).toHaveCount(2);
    const task=backlog.getByRole('listitem').first();
    await task.getByRole('combobox').first().click(); await page.getByRole('option',{name:'JA',exact:true}).click();
    await expect(backlog.getByRole('listitem')).toHaveCount(1);
    await page.goto('/dev-preview?tab=money');
    const costs=page.getByTestId('project-cost-overview');await expect(costs).toBeVisible();
    for(const name of ['DNESKAi','devShark','heyDarlink','NaviGym']) await expect(costs.getByRole('table')).toContainText(name);
    await costs.locator('summary').first().click();
    await expect(costs.getByText(lang==='cs'?'Živý nákladový ledger je dostupný po přihlášení.':'The live cost ledger is available after sign-in.').first()).toBeVisible();
    for(const width of [360,430,768,1024,1440,1728]){
      await page.setViewportSize({width,height:900});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBe(true);
    }
    expect((await new AxeBuilder({page:page as unknown as AxePage}).include('[data-testid="project-cost-overview"]').analyze()).violations).toEqual([]);
    await page.screenshot({path:`test-results/project-costs-${lang}.png`});
    expect(calls).toEqual([]);expect(errors).toEqual([]);
  });
}
