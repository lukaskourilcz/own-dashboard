import { afterEach, describe, expect, it, vi } from "vitest";
import { daysUntilDate } from "@/lib/date-keys";

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.resetModules(); });

describe("demo calendar dates remain local", () => {
  it.each(["2026-10-13T22:30:00Z", "2026-10-24T22:30:00Z"])("keeps renewal offsets after Prague midnight at %s", async instant => {
    vi.stubEnv("TZ", "Europe/Prague");
    vi.useFakeTimers();
    const now = new Date(instant);
    vi.setSystemTime(now);
    vi.resetModules();
    const { subscriptions } = await import("@/lib/demo/fixtures");
    expect(now.getHours()).toBe(0);
    expect(daysUntilDate(subscriptions.find(item => item.name === "Netflix")!.next_billing_date!, now)).toBe(8);
    expect(daysUntilDate(subscriptions.find(item => item.name === "Figma")!.next_billing_date!, now)).toBe(120);
  });
});
