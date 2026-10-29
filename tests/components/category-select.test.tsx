// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi, type Mock } from "vitest";
import { CategorySelect } from "@/components/category-select";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmationProvider } from "@/components/ui/confirmation-dialog";
import { categories } from "@/lib/i18n/sections/categories";
import { common } from "@/lib/i18n/sections/common";
const state = vi.hoisted(() => ({ add: vi.fn(), remove: vi.fn(), reload: vi.fn(), failed: false, ready: true }));
vi.mock("@/lib/i18n", () => ({ useLang: () => ({ lang: "en" }), useDict: () => ({ categories: categories.en, common: common.en }) }));
const row = { id: "22222222-2222-4222-8222-222222222222", user_id: "11111111-1111-4111-8111-111111111111", name: "Software", sort_order: 1, created_at: "2026-10-25T00:00:00Z" };
vi.mock("@/lib/use-spend-categories", () => ({ useSpendCategories: () => ({ categories: [row], addCategory: state.add, removeCategory: state.remove, reload: state.reload, failed: state.failed, ready: state.ready, loading: false, refreshing: false, readOnly: false }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, changed: Mock<(value: string) => void>;
beforeEach(() => { state.add.mockReset(); state.remove.mockReset(); state.reload.mockReset(); state.failed = false; state.ready = true; changed = vi.fn<(value: string) => void>(); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(() => { act(() => root.unmount()); host.remove(); });
async function mount(value = "", contextKey = "initial") { await act(async () => root.render(<TooltipProvider><ConfirmationProvider><CategorySelect id="category-field" contextKey={contextKey} value={value} onChange={changed} used={["Legacy category"]} /></ConfirmationProvider></TooltipProvider>)); act(() => (host.querySelector('button[aria-label="Manage categories"]') as HTMLButtonElement).click()); }
const dialog = () => document.querySelector('[role="dialog"]')!;
const form = () => dialog().querySelector("form")!;
it("keeps the draft and selection until a confirmed canonical category returns", async () => {
  let release!: (saved: typeof row) => void; state.add.mockImplementation(() => new Promise(resolve => { release = resolve; })); await mount();
  const input = form().querySelector("input")!;
  act(() => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!; setter.call(input, "software"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(state.add).toHaveBeenCalledTimes(1);
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); expect(state.add).toHaveBeenCalledTimes(1);
  expect(changed).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).not.toBeNull(); expect(input.disabled).toBe(true);
  await act(async () => release(row)); expect(changed).toHaveBeenCalledWith("Software"); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("retains a rejected draft and exposes one inline retryable error", async () => {
  state.add.mockRejectedValue(new Error("PRIVATE TEST database error")); await mount(); const input = form().querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "New category"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(changed).not.toHaveBeenCalled(); expect(input.value).toBe("New category"); expect(dialog().querySelector('[role="alert"]')).not.toBeNull(); expect(dialog().textContent).not.toContain("PRIVATE TEST");
});
it("gives the creation input a persistent associated label", async () => {
  await mount(); const input = form().querySelector("input")!; expect(input.id).not.toBe(""); expect(dialog().querySelector(`label[for="${input.id}"]`)?.textContent).toBe("New category name");
});
it("shows a failed managed read instead of an empty list and disables creation", async () => {
  state.failed = true; state.ready = false; await mount(); expect(dialog().querySelector('[role="alert"]')).not.toBeNull(); expect(form().querySelector('button[type="submit"]')).toHaveProperty("disabled", true);
});

it("shows a case-insensitive current value using the managed canonical option", async () => {
  await mount("software"); expect(host.querySelector('[role="combobox"]')?.textContent).toContain("Software"); expect(changed).not.toHaveBeenCalled();
});
it("does not select a late category into a different item", async () => {
  let release!: (saved: typeof row) => void; state.add.mockImplementation(() => new Promise(resolve => { release = resolve; })); await mount();
  const input = form().querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Cloud"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await act(async () => root.render(<TooltipProvider><ConfirmationProvider><CategorySelect id="category-field" contextKey="different" value="" onChange={changed} /></ConfirmationProvider></TooltipProvider>));
  await act(async () => release(row)); expect(changed).not.toHaveBeenCalled(); expect(input.value).toBe("Cloud"); expect(dialog().querySelector('[role="alert"]')?.textContent).toContain(categories.en.contextChanged);
});
it("captures the removal before confirmation and a cancelled confirmation performs no write", async () => {
  await mount(); const button = () => document.querySelector('button[aria-label="Remove category: Software"]') as HTMLButtonElement;
  await act(async () => button().click()); const confirmation = document.querySelector(".confirmation-dialog")!;
  expect(confirmation.textContent).toContain("Existing subscriptions and transactions keep their labels."); expect(state.remove).not.toHaveBeenCalled();
  await act(async () => ([...confirmation.querySelectorAll("button")].find(item => item.textContent === "Cancel") as HTMLButtonElement).click());
  expect(state.remove).not.toHaveBeenCalled(); expect(button().disabled).toBe(false);
});
it("keeps a portaled category submit out of its parent entity form", async () => {
  const parentSubmit = vi.fn(); state.add.mockResolvedValue(row);
  await act(async () => root.render(<TooltipProvider><ConfirmationProvider><form onSubmit={event => { event.preventDefault(); parentSubmit(); }}><CategorySelect value="" onChange={changed} /></form></ConfirmationProvider></TooltipProvider>));
  act(() => (host.querySelector('button[aria-label="Manage categories"]') as HTMLButtonElement).click());
  const input = form().querySelector("input")!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Cloud"); input.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => form().dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(state.add).toHaveBeenCalledTimes(1); expect(parentSubmit).not.toHaveBeenCalled();
});
