import { expect, it } from "vitest";
import { safeWebUrl } from "@/lib/web-url";
it.each(["javascript:alert(1)", "data:text/html,bad", "//example.test", "/cv", "https://name:password@example.test", "https://example.test/\ncv", "x".repeat(2001), "", null, 42])("refuses unsafe or incomplete CV links (%j)", value => { expect(safeWebUrl(value)).toBeNull(); });
it("preserves valid document fragments/queries and permits an in-progress draft to remain a string elsewhere", () => {
  expect(safeWebUrl(" https://docs.google.com/document/d/example/edit#heading=h.test ")).toBe("https://docs.google.com/document/d/example/edit#heading=h.test");
  expect(safeWebUrl("http://example.test/cv?q=test")).toBe("http://example.test/cv?q=test");
});
