import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PROJECT_TAB_IDS } from '@/lib/project-workspace-tabs';
import { createMigratedDatabase } from '../helpers/supabase-pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const migration = readFileSync('supabase/migrations/20261021124712_dneskai_hideable_project_tabs.sql', 'utf8');
const dneskaiTabs = ['dneskai-review', 'dneskai-calendar', 'dneskai-published', 'dneskai-costs'];
let db: PGlite;

const hidden = async () =>
  (await db.query<{ tabs: string[] }>('select hidden_project_tabs tabs from public.user_preferences where user_id=$1', [owner])).rows[0]?.tabs;
const save = (tabs: string[]) =>
  db.query('update public.user_preferences set hidden_project_tabs=$2 where user_id=$1', [owner, tabs]);

beforeAll(async () => {
  db = await createMigratedDatabase({ owner, instant: '2026-10-21T10:00:00.000Z' });
  await db.query("insert into public.user_preferences(user_id,hidden_project_tabs) values($1,array['sources','monetization'])", [owner]);
}, 120000);
afterAll(async () => { await db?.close(); });

describe('hideable DNESKAi project tabs', () => {
  it('ends the migration chain with a check that allows exactly the application tab ids', async () => {
    const { rows } = await db.query<{ def: string }>(
      "select pg_get_constraintdef(oid) def from pg_constraint where conname='user_preferences_hidden_project_tabs_check'");
    expect(rows).toHaveLength(1);
    expect([...rows[0]!.def.matchAll(/'([^']+)'/g)].map((match) => match[1])).toEqual([...PROJECT_TAB_IDS]);
  });

  it('accepts the four DNESKAi tab ids beside the other project tabs', async () => {
    await save(['tasks', ...dneskaiTabs]);
    expect(await hidden()).toEqual(['tasks', ...dneskaiTabs]);
  });

  it('rejects an id that is not a project tab and keeps the stored value', async () => {
    await save(['dneskai-calendar']);
    await expect(save(['dneskai-calendar', 'dneskai-unknown'])).rejects.toThrow('user_preferences_hidden_project_tabs_check');
    await expect(save(['operations'])).rejects.toThrow('user_preferences_hidden_project_tabs_check');
    expect(await hidden()).toEqual(['dneskai-calendar']);
  });

  it('applies again over stored rows without rewriting them', async () => {
    await save(['sources', 'monetization', 'dneskai-costs']);
    await db.exec(migration);
    expect(await hidden()).toEqual(['sources', 'monetization', 'dneskai-costs']);
  });
});
