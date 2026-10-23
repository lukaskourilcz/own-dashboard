// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GuestBoundary } from "@/components/guest-boundary";
import { dashboardBrowserFetch, guestProtectedUrl } from "@/lib/guest-requests";
import { guest } from "@/lib/i18n/sections/guest";
import { relinkGoogle } from "@/lib/google-auth";
import { connectGitHub } from "@/lib/github-auth";

vi.mock("@/lib/i18n", () => ({ useDict: () => ({ guest: guest.en }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => { throw new Error("Tour must not start OAuth"); } }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
const network = vi.fn<typeof fetch>();
beforeEach(() => {
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  network.mockReset().mockResolvedValue(new Response("asset"));
  vi.stubGlobal("fetch", network);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.example");
  document.documentElement.lang = "en";
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); document.documentElement.lang = ""; });

it("isolates fixtures from an existing owner's query cache", () => {
  const owner = new QueryClient(); owner.setQueryData(["projects"], ["private owner project"]);
  function Sample() {
    const { data } = useQuery({ queryKey: ["projects"], initialData: ["sample project"], enabled: false });
    return <p>{data![0]}</p>;
  }
  act(() => root.render(<QueryClientProvider client={owner}><GuestBoundary><Sample /></GuestBoundary></QueryClientProvider>));
  expect(host.textContent).toBe("sample project");
  expect(owner.getQueryData(["projects"])).toEqual(["private owner project"]);
  owner.clear();
});

it("blocks API reads, writes, database clients and exports after in-shell navigation", async () => {
  act(() => root.render(<GuestBoundary><a href="/api/export/full" download>Export</a><form action="/auth/signout" method="post"><button>Sign out</button></form></GuestBoundary>));
  expect(document.documentElement.dataset.guestTour).toBe("true");
  await act(async () => {
    expect((await fetch("/api/integrations/status")).status).toBe(403);
    expect((await fetch("/api/calendar/event", { method: "POST" })).status).toBe(403);
    expect((await dashboardBrowserFetch("https://backend.example/rest/v1/notes")).status).toBe(403);
    expect((await relinkGoogle()).error).toBe(guest.en.readOnlyAction);
    expect((await connectGitHub()).error).toBe(guest.en.readOnlyAction);
  });
  const exportClick = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => host.querySelector("a")!.dispatchEvent(exportClick));
  expect(exportClick.defaultPrevented).toBe(true);
  const submit = new Event("submit", { bubbles: true, cancelable: true });
  act(() => host.querySelector("form")!.dispatchEvent(submit));
  expect(submit.defaultPrevented).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toBe(guest.en.readOnlyAction);
  expect(network).not.toHaveBeenCalled();
  await fetch("/brand/mark.svg");
  expect(network).toHaveBeenCalledTimes(1);
  act(() => root.render(<p>Owner app</p>));
  expect(document.documentElement.dataset.guestTour).toBeUndefined();
  expect(fetch).toBe(network);
  await dashboardBrowserFetch("/api/integrations/status");
  expect(network).toHaveBeenCalledTimes(2);
});

it("matches only the app's live endpoints and its database origin", () => {
  expect(guestProtectedUrl("/api/export/full?format=csv", "https://app.example", "https://backend.example")).toBe(true);
  expect(guestProtectedUrl("https://backend.example/auth/v1/user", "https://app.example", "https://backend.example")).toBe(true);
  expect(guestProtectedUrl("/login", "https://app.example", "https://backend.example")).toBe(false);
  expect(guestProtectedUrl("https://docs.example/api/guide", "https://app.example", "https://backend.example")).toBe(false);
});
