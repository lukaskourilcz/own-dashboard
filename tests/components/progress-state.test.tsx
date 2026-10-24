// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { Progress } from "@/components/ui/progress";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root, host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); });
function render(value?: number | null, max?: number) {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  act(() => root.render(<Progress value={value} max={max} aria-label="Release tasks"/>));
  return host.querySelector('[role="progressbar"]')!;
}
it("exposes the same numeric value shown to sighted users", () => {
  const bar = render(50); expect(bar.getAttribute("aria-valuenow")).toBe("50"); expect(bar.getAttribute("aria-valuemax")).toBe("100");
  expect(bar.getAttribute("data-state")).toBe("loading"); expect((bar.firstElementChild as HTMLElement).style.transform).toBe("translateX(-50%)");
});
it("supports a caller's maximum without changing the visual proportion", () => {
  const bar = render(5, 10); expect(bar.getAttribute("aria-valuenow")).toBe("5"); expect(bar.getAttribute("aria-valuemax")).toBe("10");
  expect((bar.firstElementChild as HTMLElement).style.transform).toBe("translateX(-50%)");
});
it.each([[120, 100, "complete"], [-10, 0, "loading"]] as const)("keeps an out-of-range value %s consistent in both representations", (input, expected, state) => {
  const bar = render(input); expect(bar.getAttribute("aria-valuenow")).toBe(String(expected)); expect(bar.getAttribute("data-state")).toBe(state);
});
it.each([undefined, null, NaN, Infinity])("keeps an unavailable value indeterminate", value => {
  const bar = render(value); expect(bar.hasAttribute("aria-valuenow")).toBe(false); expect(bar.getAttribute("data-state")).toBe("indeterminate");
});
