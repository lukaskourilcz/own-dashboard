import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

/** The series wave ledger (owner decision, 8 November 2026) in isolated PGlite; every value is synthetic. */
let db: PGlite;
const owner = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
type Decision = { admitted: boolean; id?: string; lastStartedAt?: string | null };
const reserve = async (cap: number, gap = 12, user = owner) =>
  (await db.query<{ r: Decision }>("select marketing_reserve_dneskai_series_wave($1,$2,$3) r", [user, cap, gap])).rows[0]!.r;
const settle = async (id: string, apify: number, model: number, inserted = 3, code: string | null = null, user = owner) =>
  (await db.query<{ r: boolean }>("select marketing_settle_dneskai_series_wave($1,$2,$3,$4,$5,$6) r", [user, id, apify, model, inserted, code])).rows[0]!.r;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create schema auth; create table auth.users(id uuid primary key); create role anon; create role authenticated; create role service_role bypassrls;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
  create schema marketing_private; insert into auth.users values('${owner}'),('${other}');`);
  await db.exec(readFileSync("supabase/migrations/20261109010000_dneskai_series_waves.sql", "utf8"));
}, 60000);
beforeEach(async () => { await db.exec("truncate marketing_private.dneskai_series_waves"); });
afterAll(async () => { await db?.close(); });

describe("DNESKAi series wave ledger", () => {
  it("is service-only", async () => {
    for (const fn of ["marketing_reserve_dneskai_series_wave(uuid,numeric,integer)", "marketing_settle_dneskai_series_wave(uuid,uuid,numeric,numeric,integer,text)"]) {
      const { rows } = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>("select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,has_function_privilege('service_role',$1,'EXECUTE') service", [fn]);
      expect(rows[0], fn).toEqual({ anon: false, authenticated: false, service: true });
    }
  });

  it("admits one wave per gap, also after a failed one, and per owner", async () => {
    const first = await reserve(1.5);
    expect(first.admitted).toBe(true);
    expect(await settle(first.id!, 0, 0.02, 0, "series-wave-failed")).toBe(true);
    expect((await reserve(1.5)).admitted).toBe(false);
    expect((await reserve(1.5, 12, other)).admitted).toBe(true);
    await db.exec("update marketing_private.dneskai_series_waves set started_at=now()-interval '13 days'");
    expect((await reserve(1.5)).admitted).toBe(true);
  });

  it("refuses a cap above $5 and an invalid settlement, and settles only once", async () => {
    await expect(reserve(5.01)).rejects.toThrow("series wave reservation invalid");
    await expect(reserve(0)).rejects.toThrow("series wave reservation invalid");
    const wave = await reserve(1.5);
    await expect(settle(wave.id!, -1, 0)).rejects.toThrow("series wave settlement invalid");
    await expect(settle(wave.id!, 0.1, 0.1, 2, "Bad Code")).rejects.toThrow("series wave settlement invalid");
    expect(await settle(wave.id!, 0.12, 0.3, 9)).toBe(true);
    expect(await settle(wave.id!, 0, 0)).toBe(false);
    const { rows } = await db.query<{ cost_usd: string; inserted: number }>("select cost_usd,inserted from marketing_private.dneskai_series_waves");
    expect(rows).toEqual([{ cost_usd: "0.4200", inserted: 9 }]);
  });
});
