// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { qk } from "@/lib/queries/keys";
import { SettingsPanel } from "@/components/panels/settings-panel";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); document.documentElement.lang = ""; vi.unstubAllGlobals(); });
async function render(lang = "en", enabled = true) {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = lang;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={client}><SettingsPanel syncPreferences={enabled} /></QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
const status = { google: { configured: true, connected: true }, github: { configured: false, connected: false },
  bank: { connected: true, configured: true, last_synced_at: "2026-10-24T01:00:00Z", providers: [{ id: "fio", label: "Fio banka", configured: true, connected: true, supportsInstitutionPicker: false }] }, email: { configured: false } };
it.each(["en", "cs"])("exposes localized status retry and retains confirmed values without a duplicate bank summary (%s)", async lang => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("integrations/status") ? Response.json(failed ? { error: "unavailable" } : status, { status: failed ? 503 : 200 }) : Response.json({ notifications_renewals: true })));
  await render(lang); const card = document.querySelector("#settings-integrations")!;
  expect(card.querySelector('[role="alert"]')).not.toBeNull(); expect(card.textContent).not.toContain("not_connected"); expect(card.textContent).not.toContain("Google");
  failed = false;
  await act(async () => { (card.querySelector("button") as HTMLButtonElement).click(); await new Promise(resolve => setTimeout(resolve, 40)); });
  expect(card.querySelector('[role="alert"]')).toBeNull(); expect(card.textContent).toContain("Google"); expect(card.textContent).toContain("Fio banka");
  expect(card.textContent?.match(/Fio banka/g)).toHaveLength(1); expect(card.textContent).toContain("2026-10-24");
  failed = true;
  await act(async () => { await client.refetchQueries({ queryKey: qk.integrationStatus }); await new Promise(resolve => setTimeout(resolve, 30)); });
  expect(card.querySelector('[role="alert"]')).not.toBeNull(); expect(card.textContent).toContain("Fio banka");
});
it("refuses malformed successful replies instead of rendering false states", async () => {
  vi.stubGlobal("fetch", vi.fn(async input => Response.json(String(input).includes("integrations/status") ? { google: { connected: false } } : {})));
  await render(); expect(document.querySelector('#settings-integrations [role="alert"]')).not.toBeNull();
});
it("keeps the public fixture free of status reads", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher); await render("en", false);
  expect(fetcher).not.toHaveBeenCalled(); expect(document.querySelector("#settings-integrations")?.textContent).toContain("signing in");
});
