import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "@/lib/types";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
const localDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
async function inZone(zone: string) {
  vi.stubEnv("TZ", zone); vi.resetModules();
  return import("@/lib/plan-recurrence");
}
for (const zone of ["UTC", "Europe/Prague", "America/New_York", "Australia/Lord_Howe", "Asia/Kathmandu"]) {
  describe(zone, () => {
    it.each([
      [2026, 2, 30, "2026-03-23", "2026-04-06"],
      [2026, 5, 24, "2026-06-15", "2026-06-29"],
      [2026, 9, 24, "2026-10-19", "2026-11-02"],
      [2026, 9, 26, "2026-10-19", "2026-11-02"],
      [2023, 11, 31, "2023-12-18", "2024-01-01"],
    ] as const)("keeps the anchored fortnight for %i-%i-%i", async (year, month, day, start, end) => {
      const { currentPeriod } = await inZone(zone);
      const period = currentPeriod("biweekly", new Date(year, month, day, 12))!;
      expect([localDate(period.start), localDate(period.end)]).toEqual([start, end]);
      expect([period.start.getHours(), period.end.getHours()]).toEqual([0, 0]);
    });
    it("retains completion across the spring clock change and resets at the real period boundary", async () => {
      const { isDoneThisPeriod, daysLeftInPeriod, currentPeriod } = await inZone(zone);
      const plan = { recurrence: "biweekly", last_completed_at: new Date(2026, 2, 28, 12).toISOString() } as Plan;
      const now = new Date(2026, 2, 30, 12);
      expect(isDoneThisPeriod(plan, now)).toBe(true);
      expect(daysLeftInPeriod(currentPeriod("biweekly", now)!, now)).toBe(6);
      expect(isDoneThisPeriod(plan, new Date(2026, 3, 6))).toBe(false);
    });
    it("tiles every calendar day in a full leap year without gaps or overlapping starts", async () => {
      const { currentPeriod } = await inZone(zone);
      const starts: string[] = [];
      for (let day = 0; day < 366; day++) {
        const now = new Date(2024, 0, 1 + day, 12), period = currentPeriod("biweekly", now)!;
        const expectedDay = Math.floor(day / 14) * 14;
        expect([localDate(period.start), localDate(period.end)]).toEqual([localDate(new Date(2024, 0, 1 + expectedDay)), localDate(new Date(2024, 0, 15 + expectedDay))]);
        expect(now >= period.start && now < period.end).toBe(true);
        starts.push(localDate(period.start));
      }
      expect(new Set(starts).size).toBe(27);
    });
  });
}
