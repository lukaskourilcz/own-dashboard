import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMigratedDatabase } from '../helpers/supabase-pglite';
import { importContacts, parseContacts, type LeadContactRow } from '../../scripts/import-lead-contacts';

/** Opportunities → Contacts (20261112180000) in isolated PGlite: the import contract, the seed and own-only RLS. */
const owner = '11111111-1111-4111-8111-111111111111', stranger = '99999999-9999-4999-8999-999999999999';
const fixture = JSON.parse(readFileSync('tests/fixtures/leads/hodinovy-manzel/contacts.json', 'utf8')) as unknown;
let db: PGlite;
const as = async (role: string, user = owner) => { await db.query(`set role ${role}`); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); };

/** The script's batch loop against the migrated function, as the service role. */
const runImport = async (rows: LeadContactRow[], batchSize?: number) => {
  await db.query('reset role');
  await db.query('set role service_role');
  try {
    return await importContacts(async (fn, args) => {
      try {
        const result = await db.query<{ r: unknown }>(`select public.${fn}($1,$2,$3,$4::jsonb) r`, [args.p_owner, args.p_trade_slug, args.p_trade_name, JSON.stringify(args.p_rows)]);
        return { data: result.rows[0]!.r, error: null };
      } catch (error) { return { data: null, error: { message: (error as Error).message } }; }
    }, { owner: null, tradeSlug: 'hodinovy-manzel', tradeName: 'Hodinový manžel', rows, batchSize });
  } finally { await db.query('reset role'); }
};

beforeAll(async () => { db = await createMigratedDatabase({ owner, instant: '2026-11-12T12:00:00.000Z' }); }, 120000);
afterAll(async () => { await db?.close(); });

describe('lead contacts import', () => {
  it('seeds the first trade and its template for the owner', async () => {
    const trades = (await db.query<{ slug: string; name: string }>('select slug,name from public.lead_trades')).rows;
    expect(trades).toEqual([{ slug: 'hodinovy-manzel', name: 'Hodinový manžel' }]);
    const [template] = (await db.query<{ subject: string; body: string }>('select subject,body from public.lead_email_templates')).rows;
    expect(template!.subject).toContain('{{jmeno}}');
    expect(template!.body).toContain('lukas@lukaskouril.dev');
    expect(template!.body).toContain('„ne“');
    expect(template!.body).toContain('{{zdroj_url}}');
  });

  it('inserts the fixture, then updates the data on a second run without touching outreach fields', async () => {
    const rows = parseContacts(fixture, 'hodinovy-manzel');
    expect(await runImport(rows)).toEqual({ inserted: 3, updated: 0, skipped_do_not_contact: 0 });
    const email = 'jan.novak@seznam.cz';
    await db.query("update public.lead_contacts set outreach_status='contacted', note='Volat po 17:00' where email=$1", [email]);
    const stamped = (await db.query<{ last_contacted_at: Date }>('select last_contacted_at from public.lead_contacts where email=$1', [email])).rows[0]!;
    expect(new Date(stamped.last_contacted_at).toISOString()).toBe('2026-11-12T12:00:00.000Z');
    await db.query("update public.lead_contacts set outreach_status='do_not_contact', note='Nechce' where email='kutil@kutilpraha.cz'");

    const changed = rows.map((row) => ({ ...row, quality_score: row.website ? 2 : null, activity: `${row.activity}, nově` }));
    expect(await runImport(changed, 2)).toEqual({ inserted: 0, updated: 2, skipped_do_not_contact: 1 });
    const after = (await db.query<{ email: string; outreach_status: string; note: string; quality_score: number | null; activity: string; contacted: boolean }>(
      'select email,outreach_status,note,quality_score,activity,last_contacted_at is not null contacted from public.lead_contacts order by email')).rows;
    expect(after).toEqual([
      { email: 'jan.novak@seznam.cz', outreach_status: 'contacted', note: 'Volat po 17:00', quality_score: 2, activity: 'drobné opravy, montáž nábytku, elektro, nově', contacted: true },
      { email: 'kutil@kutilpraha.cz', outreach_status: 'do_not_contact', note: 'Nechce', quality_score: 7, activity: 'montáž nábytku, vrtání, věšení polic', contacted: false },
      { email: 'opravy.dvorak@gmail.com', outreach_status: 'new', note: '', quality_score: null, activity: 'údržba domů a zahrad, nově', contacted: false },
    ]);
  });

  it('adds a new trade as a new row without a schema change', async () => {
    await db.query('reset role');
    await db.query('set role service_role');
    const result = (await db.query<{ r: { inserted: number } }>("select public.import_lead_contacts(null,'kadernice','Kadeřnice',$1::jsonb) r",
      [JSON.stringify([{ ...parseContacts(fixture, 'hodinovy-manzel')[1], email: 'jana@salon.cz' }])])).rows[0]!.r;
    await db.query('reset role');
    expect(result.inserted).toBe(1);
    expect((await db.query('select slug from public.lead_trades order by slug')).rows).toEqual([{ slug: 'hodinovy-manzel' }, { slug: 'kadernice' }]);
  });

  it('refuses a contact with a website but no form status, and an unknown region', async () => {
    await expect(db.query("insert into public.lead_contacts(user_id,trade_id,name,email,email_source_url,website,source,collected_at) select $1,id,'X','x@x.cz','https://x.cz','https://x.cz','x','2026-11-12' from public.lead_trades where slug='hodinovy-manzel'", [owner])).rejects.toThrow();
    await expect(db.query("insert into public.lead_contacts(user_id,trade_id,name,email,email_source_url,region,source,collected_at) select $1,id,'X','y@x.cz','https://x.cz','Plzeň','x','2026-11-12' from public.lead_trades where slug='hodinovy-manzel'", [owner])).rejects.toThrow();
  });

  it('keeps the import away from signed-in users and every row away from strangers', async () => {
    await as('authenticated', owner);
    await expect(db.query("select public.import_lead_contacts(null,'x','X','[]'::jsonb)")).rejects.toThrow();
    expect((await db.query('select id from public.lead_contacts')).rows.length).toBe(4);
    await db.query('reset role');
    await db.query('insert into auth.users(id) values($1)', [stranger]);
    await as('authenticated', stranger);
    expect((await db.query('select id from public.lead_contacts')).rows).toHaveLength(0);
    expect((await db.query('select id from public.lead_email_templates')).rows).toHaveLength(0);
    expect((await db.query("update public.lead_contacts set note='x' returning id")).rows).toHaveLength(0);
    await db.query('reset role');
    await db.query('set role service_role');
    await expect(db.query("select public.import_lead_contacts(null,'hodinovy-manzel','Hodinový manžel','[]'::jsonb)")).rejects.toThrow('lead import owner required');
    await db.query('reset role');
  });
});

describe('parseContacts', () => {
  it('normalizes the e-mail and fills defaults', () => {
    const [first] = parseContacts(fixture, 'hodinovy-manzel');
    expect(first!.email).toBe('jan.novak@seznam.cz');
    expect(first).not.toHaveProperty('trade');
  });

  it('lists every bad record: wrong trade, duplicate e-mail, a score without a website', () => {
    const rows = fixture as Record<string, unknown>[];
    const bad = [rows[0], { ...rows[0], email: 'JAN.novak@seznam.cz' }, { ...rows[1], quality_score: 5 }, { ...rows[2], trade: 'kadernice' }, { ...rows[2], region: 'Plzeň' }];
    expect(() => parseContacts(bad, 'hodinovy-manzel')).toThrow(/4 problem\(s\)[\s\S]*#1 email[\s\S]*#2 quality_score[\s\S]*#3 trade[\s\S]*#4 region/);
    expect(() => parseContacts({}, 'hodinovy-manzel')).toThrow('JSON array');
  });
});
