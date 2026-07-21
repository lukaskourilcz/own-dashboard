import { describe, expect, it } from "vitest";
import { isActionableNotification, safeNotificationUrl } from "@/lib/notifications";
import type { AppNotification } from "@/lib/types";

const base: AppNotification = {
  id: "n1", user_id: "u1", kind: "follow_up", source_type: null,
  source_id: null, title: "Follow up", body: null, action_url: null,
  read_at: null, dismissed_at: null, snoozed_until: null,
  created_at: "2026-07-21T10:00:00Z",
};

describe("notification visibility and actions", () => {
  it("hides read, dismissed, and actively snoozed notifications", () => {
    const now = new Date("2026-07-21T12:00:00Z");
    expect(isActionableNotification(base, now)).toBe(true);
    expect(isActionableNotification({ ...base, read_at: now.toISOString() }, now)).toBe(false);
    expect(isActionableNotification({ ...base, dismissed_at: now.toISOString() }, now)).toBe(false);
    expect(isActionableNotification({ ...base, snoozed_until: "2026-07-22T12:00:00Z" }, now)).toBe(false);
    expect(isActionableNotification({ ...base, snoozed_until: "2026-07-20T12:00:00Z" }, now)).toBe(true);
  });

  it("allows only local and HTTP(S) action links", () => {
    expect(safeNotificationUrl("/invoices")).toBe("/invoices");
    expect(safeNotificationUrl("https://example.com/action")).toBe("https://example.com/action");
    expect(safeNotificationUrl("javascript:alert(1)")).toBeNull();
    expect(safeNotificationUrl("//example.com/action")).toBeNull();
  });
});
