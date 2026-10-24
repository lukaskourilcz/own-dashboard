import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { rejectCrossOrigin } from "@/lib/csrf";
const request = (headers: HeadersInit, method = "POST") => new Request("https://app.example/api/action", { method, headers });
it.each(["http://app.example", "https://other.example", "https://app.example:444", "https://person:synthetic@app.example", "null", "not-a-url"])("refuses a different or invalid browser origin (%s)", origin => {
  expect(rejectCrossOrigin(request({ origin }))?.status).toBe(403);
});
it("accepts a normalized same origin and the deliberate Referer fallback", () => {
  expect(rejectCrossOrigin(request({ origin: "https://app.example:443" }))).toBeNull();
  expect(rejectCrossOrigin(request({ referer: "https://app.example/projects/fixture?tab=notes" }))).toBeNull();
  expect(rejectCrossOrigin(request({ origin: "https://other.example", referer: "https://app.example/" }))?.status).toBe(403);
});
it("retains safe methods and refuses a mutation without browser origin evidence", () => {
  expect(rejectCrossOrigin(request({}, "GET"))).toBeNull(); expect(rejectCrossOrigin(request({}))?.status).toBe(403);
});
