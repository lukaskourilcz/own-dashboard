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

  it("labels the VAT verification states in both locales", () => {
    expect(statusLabel("vat_valid", "en")).toBe("VAT valid");
    expect(statusLabel("vat_valid", "cs")).toBe("DIČ platné");
    expect(statusLabel("vat_unavailable", "cs")).toBe("Ověření nedostupné");
    expect(statusLabel("vat_unchecked", "en")).toBe("VAT unchecked");
  });

  it("uses semantic tones consistently", () => {
    expect(statusTone("won")).toBe("success");
    expect(statusTone("proposal_sent")).toBe("warning");
    expect(statusTone("overdue")).toBe("risk");
    expect(statusTone("lost")).toBe("destructive");
  });

  it("separates an invalid VAT id from a registry that did not answer", () => {
    expect(statusTone("vat_valid")).toBe("success");
    expect(statusTone("vat_invalid")).toBe("destructive");
    expect(statusTone("vat_unavailable")).toBe("warning");
    expect(statusTone("vat_unchecked")).toBe("neutral");
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
