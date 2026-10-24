import { expect, it } from "vitest";
import { FakeInternet } from "../helpers/dneskai-dry-day-world";
it("cancels a pending fake fetch even when its handler never observes cancellation", async () => {
  const internet = new FakeInternet(() => new Date());
  internet.route("fixture.example", async () => new Promise<Response>(() => {}));
  const controller = new AbortController();
  const pending = internet.fetch("https://fixture.example/hang", { signal: controller.signal });
  controller.abort(new DOMException("Synthetic cancellation", "AbortError"));
  await expect(pending).rejects.toMatchObject({ name: "AbortError" });
});
it("refuses an already cancelled request before invoking its handler", async () => {
  const internet = new FakeInternet(() => new Date()); let calls = 0;
  internet.route("fixture.example", async () => { calls++; return Response.json({ ok: true }); });
  await expect(internet.fetch("https://fixture.example/hang", { signal: AbortSignal.abort() })).rejects.toMatchObject({ name: "AbortError" });
  expect(calls).toBe(0);
});
it("observes the original native deadline for a hanging handler", async () => {
  const internet = new FakeInternet(() => new Date());
  internet.route("fixture.example", async () => new Promise<Response>(() => {}));
  await expect(internet.fetch("https://fixture.example/hang", { signal: AbortSignal.timeout(10) })).rejects.toMatchObject({ name: "TimeoutError" });
});
