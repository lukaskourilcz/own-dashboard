import { expect, it } from "vitest";
import { focusDayKey } from "@/lib/date-keys";
it("matches the configured focus timezone across midnight and DST", () => {
  expect(focusDayKey(new Date("2026-10-23T22:30:00Z"))).toBe("2026-10-24");
  expect(focusDayKey(new Date("2026-10-23T22:30:00Z"), "America/Los_Angeles")).toBe("2026-10-23");
  expect(focusDayKey(new Date("2026-10-25T22:30:00Z"))).toBe("2026-10-25");
  expect(focusDayKey(new Date("2026-10-23T22:30:00Z"), "invalid")).toBe("2026-10-24");
});
