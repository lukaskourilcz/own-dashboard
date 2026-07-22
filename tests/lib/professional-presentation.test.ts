import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { statusLabel, statusTone } from "@/lib/status-presentation";

describe("professional status presentation", () => {
  it("localizes internal enum values without leaking underscores", () => {
    expect(statusLabel("proposal_sent", "en")).toBe("Proposal sent");
    expect(statusLabel("proposal_sent", "cs")).toBe("Nabídka odeslána");
    expect(statusLabel("prospective_client", "cs")).toBe("Potenciální klient");
    expect(statusLabel("planned", "en")).toBe("Planned");
  });

  it("uses semantic tones consistently", () => {
    expect(statusTone("won")).toBe("success");
    expect(statusTone("proposal_sent")).toBe("warning");
    expect(statusTone("overdue")).toBe("risk");
    expect(statusTone("lost")).toBe("destructive");
  });
});

describe("atomic Inbox migration contract", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260722150000_atomic_inbox_routing.sql", import.meta.url),
    "utf8",
  ).toLowerCase();

  it("keeps routing inside the caller's RLS boundary", () => {
    expect(sql).toContain("security invoker");
    expect(sql).not.toContain("security definer");
    expect(sql).toContain("where id = p_inbox_item_id and user_id = v_user_id");
    expect(sql).toContain("revoke all on function public.route_inbox_item(uuid, text) from public, anon");
  });

  it("locks and records an idempotent route", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("if v_item.status = 'processed'");
    expect(sql).toContain("'routed_record_id'");
  });
});
