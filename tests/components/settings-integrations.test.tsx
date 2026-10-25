// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Storage } from "happy-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { qk } from "@/lib/queries/keys";
import { OwnerPreferencesProvider } from "@/lib/owner-preferences";
import { SettingsPanel } from "@/components/panels/settings-panel";
import { DEFAULT_UI_PREFERENCES } from "@/lib/ui-preferences-contract";
import { settings } from "@/lib/i18n/sections/settings";
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement, client: QueryClient;
afterEach(() => { act(() => root?.unmount()); host?.remove(); client?.clear(); document.documentElement.lang = ""; vi.unstubAllGlobals(); });
async function render(lang = "en", enabled = true, capturedOwner = true) {
  vi.stubGlobal("localStorage", new Storage()); document.documentElement.lang = lang;
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => { root!.render(<QueryClientProvider client={client}>{capturedOwner ? <OwnerPreferencesProvider ownerId="owner"><SettingsPanel syncPreferences={enabled} /></OwnerPreferencesProvider> : <SettingsPanel syncPreferences={enabled} />}</QueryClientProvider>); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
}
const status = { google: { configured: true, connected: true }, github: { configured: false, connected: false },
  bank: { connected: true, configured: true, last_synced_at: "2026-10-24T01:00:00Z", providers: [{ id: "fio", label: "Fio banka", configured: true, connected: true, supportsInstitutionPicker: false }] }, email: { configured: false } };
it.each(["en", "cs"])("exposes localized status retry and retains confirmed values without a duplicate bank summary (%s)", async lang => {
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async input => String(input).includes("integrations/status") ? Response.json(failed ? { error: "unavailable" } : status, { status: failed ? 503 : 200 }) : Response.json({ ...DEFAULT_UI_PREFERENCES, notifications_renewals: true, sync_available: true, ownerId: "owner" })));
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
it.each(["en", "cs"])("keeps renewal unknown on failure, retries and confirms the saved value (%s)", async lang => {
  let failed = true, release: ((response: Response) => void) | undefined;
  const fetcher = vi.fn(async (input, init) => {
    if (String(input).includes("integrations/status")) return Response.json(status);
    expect(init?.headers["x-own-dashboard-owner"]).toBe("owner");
    if (init?.method === "PATCH") return new Promise<Response>(resolve => { release = resolve; });
    return failed ? new Response(null, { status: 503 }) : Response.json({ ...DEFAULT_UI_PREFERENCES, notifications_renewals: false, sync_available: true, ownerId: "owner" });
  });
  vi.stubGlobal("fetch", fetcher); await render(lang);
  const name = settings[lang as "en" | "cs"].renewalNotifications;
  const control = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(node => node.getAttribute("aria-label") === name);
  expect(control).toBeDefined(); expect(control!.disabled).toBe(true);
  failed = false;
  await act(async () => { await client.refetchQueries({ queryKey: qk.userPreferences }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(control!.disabled).toBe(false); expect(control!.getAttribute("aria-checked")).toBe("false");
  await act(async () => { control!.click(); });
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  expect(control!.disabled).toBe(true); expect(control!.getAttribute("aria-checked")).toBe("true");
  await act(async () => { release!(Response.json({ ok: true, ownerId: "owner", saved: { notifications_renewals: true } })); await new Promise(resolve => setTimeout(resolve, 20)); });
  expect(control!.disabled).toBe(false); expect(control!.getAttribute("aria-checked")).toBe("true");
  expect(client.getQueryData([...qk.userPreferences, "owner"])).toMatchObject({ notifications_renewals: true });
});

it("does not load private preferences without a captured owner scope", async () => {
  const fetcher = vi.fn(async (_input: unknown) => { void _input; return Response.json(status); }); vi.stubGlobal("fetch", fetcher);
  await render("en", true, false);
  expect(fetcher.mock.calls.every(([input]) => !String(input).includes("/api/user/preferences"))).toBe(true);
  const control = [...host.querySelectorAll<HTMLButtonElement>('[role="switch"]')].find(node => node.getAttribute("aria-label") === settings.en.renewalNotifications);
  expect(control?.disabled).toBe(true);
});
