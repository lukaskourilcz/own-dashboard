import { test, expect, type Page } from '@playwright/test';
import { gotoPreview, watchConsole } from './helpers';
import { todos } from '../src/lib/i18n/sections/todos';
import { common } from '../src/lib/i18n/sections/common';
import { nav } from '../src/lib/i18n/sections/nav';
import { owner, task } from './task-fixtures';
async function fixture(page: Page, lang: 'en' | 'cs') {
  await gotoPreview(page, { lang });
  const first = task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'TEST_ONLY first task'), second = task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'TEST_ONLY second task');
  let rows = [first, second], reads = 0;
  await page.route('**/rest/v1/rpc/read_owned_collection', route => { expect(route.request().postDataJSON().p_entity).toBe('todos'); reads++; return route.fulfill({ json: rows }); });
  await page.goto('/dev-preview?tasks=live'); await page.getByRole('button', { name: nav[lang].sections.tasks, exact: true }).click();
  await expect(page.getByRole('checkbox', { name: first.title, exact: true })).toBeVisible();
  return { first, second, rows: () => rows, update: (next: typeof rows) => { rows = next; }, reads: () => reads };
}
for (const lang of ['en', 'cs'] as const) {
  test(`${lang}: task completion waits for its receipt and failure retains another successful action`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang); let release!: () => void; const requests: Record<string, unknown>[] = [];
    await page.route('**/rest/v1/rpc/write_task', async route => {
      const input = route.request().postDataJSON(); requests.push(input); expect(input.p_owner).toBe(owner); expect(input.p_action).toBe('toggle');
      if (requests.length === 1) { await new Promise<void>(resolve => { release = resolve; }); return route.fulfill({ status: 503, json: { message: 'TEST_ONLY_PRIVATE' } }); }
      const saved = { ...input.p_expected, done: input.p_values.done, updated_at: '2026-10-25T00:00:00.000002Z' };
      f.update(f.rows().map(row => row.id === input.p_id ? saved : row)); return route.fulfill({ json: { kind: 'saved', ownerId: owner, id: input.p_id, task: saved } });
    });
    const first = page.getByRole('checkbox', { name: f.first.title, exact: true }); await first.click(); await expect.poll(() => requests.length).toBe(1);
    await expect(first).toBeDisabled(); await expect(first).not.toBeChecked(); await first.dispatchEvent('click'); expect(requests.length).toBe(1);
    await page.getByRole('checkbox', { name: f.second.title, exact: true }).click(); await expect.poll(() => requests.length).toBe(2);
    await expect(page.getByRole('checkbox', { name: f.second.title, exact: true })).toHaveCount(0);
    release(); await expect(first).toBeEnabled(); await expect(page.getByText(todos[lang].saveErr, { exact: true })).toBeVisible(); await expect.poll(f.reads).toBe(2);
    expect(f.rows()[1].done).toBe(true); expect(requests[0].p_expected).toEqual(f.first); await expect(page.getByText('TEST_ONLY_PRIVATE', { exact: true })).toHaveCount(0);
    const reads = f.reads(); await first.click(); await expect(first).toHaveCount(0); expect(f.reads()).toBe(reads); expect(requests[2]).toEqual(requests[0]); await expect(page.getByRole("button", { name: todos[lang].addTask, exact: true })).toBeFocused();
    expect(errors.filter(error => !/^Failed to load resource: the server responded with a status of 503 .*\(https:\/\/example\.supabase\.co\/rest\/v1\/rpc\/write_task\)$/.test(error))).toEqual([]);
  });
  test(`${lang}: task deletion retains a conflicting row and removes only a confirmed retry`, async ({ page }) => {
    const errors = watchConsole(page), f = await fixture(page, lang); let calls = 0;
    await page.route('**/rest/v1/rpc/write_task', async route => {
      const input = route.request().postDataJSON(); calls++; expect(input.p_owner).toBe(owner); expect(input.p_action).toBe('delete'); expect(input.p_values).toEqual({});
      if (calls === 1) return route.fulfill({ json: { kind: 'conflict', ownerId: owner, id: input.p_id, task: f.first } });
      f.update(f.rows().filter(row => row.id !== input.p_id)); return route.fulfill({ json: { kind: 'deleted', ownerId: owner, id: input.p_id, task: null } });
    });
    const checkbox = page.getByRole('checkbox', { name: f.first.title, exact: true }), row = page.getByRole('listitem').filter({ has: checkbox });
    await row.getByRole('button', { name: common[lang].delete, exact: true }).click(); const dialog = page.getByRole('dialog', { name: common[lang].delete, exact: true }); await expect(dialog).toBeVisible(); expect(calls).toBe(0);
    await dialog.getByRole('button', { name: common[lang].delete, exact: true }).click(); await expect(page.getByText(todos[lang].taskChanged, { exact: true })).toBeVisible(); await expect(checkbox).toBeEnabled(); await expect.poll(f.reads).toBe(2);
    await row.getByRole('button', { name: common[lang].delete, exact: true }).click(); await dialog.getByRole('button', { name: common[lang].cancel, exact: true }).click(); expect(calls).toBe(1);
    await row.getByRole('button', { name: common[lang].delete, exact: true }).click(); await dialog.getByRole('button', { name: common[lang].delete, exact: true }).click(); await expect(checkbox).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: f.second.title, exact: true })).toBeVisible(); expect(calls).toBe(2); expect(errors).toEqual([]);
  });
}
