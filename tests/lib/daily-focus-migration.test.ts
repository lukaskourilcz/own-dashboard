import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const sql = readFileSync(
  new URL(
    "../../supabase/migrations/20260723065433_daily_focus_synced_preferences.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("daily focus migration contract", () => {
  it("keeps the creation RPC inside the caller's RLS boundary", () => {
    expect(sql).toMatch(/create_daily_focus_set[\s\S]+security invoker/i);
    expect(sql).toMatch(/grant execute[\s\S]+to authenticated/i);
    expect(sql).toMatch(/revoke all[\s\S]+from anon/i);
  });

  it("enforces global priority and excludes inactive project tasks", () => {
    expect(sql).toMatch(/if new\.is_global then[\s\S]+new\.importance := 6/i);
    expect(sql).toMatch(/t\.is_global[\s\S]+p\.is_active/i);
  });

  it("protects daily focus rows with own-only RLS", () => {
    expect(sql).toMatch(/daily_focus_sets enable row level security/i);
    expect(sql).toMatch(/daily_focus_items enable row level security/i);
    expect(sql.match(/\(select auth\.uid\(\)\) = user_id/g)?.length).toBeGreaterThanOrEqual(6);
  });
});
