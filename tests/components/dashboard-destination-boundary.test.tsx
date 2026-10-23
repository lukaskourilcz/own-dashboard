// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useEntityStore } from "@/lib/queries/entities";
import { DashboardDestinationBoundary } from "@/components/dashboard-destination-state";
import { common } from "@/lib/i18n/sections/common";

vi.mock("@/lib/i18n", () => ({ useDict: () => ({ common: common.en }) }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => { host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }); });
afterEach(() => { act(() => root.unmount()); host.remove(); client.clear(); });
const wait = () => act(async () => { await new Promise(done => setTimeout(done, 20)); });

it("keeps writable children unmounted after a failed initial read, then recovers on retry", async () => {
  const load = vi.fn<() => Promise<string[]>>().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(["owner record"]);
  function Destination() {
    const [records, , status] = useEntityStore(["records"], [], load, { seeded: false });
    return <DashboardDestinationBoundary statuses={[status]} onRetry={() => void client.refetchQueries({ queryKey: ["records"] })}><form><input aria-label="record" defaultValue={records[0]} /></form></DashboardDestinationBoundary>;
  }
  act(() => root.render(<QueryClientProvider client={client}><Destination /></QueryClientProvider>));
  expect(host.querySelector("form")).toBeNull();
  await wait();
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
  expect(host.querySelector("form")).toBeNull();
  act(() => host.querySelector<HTMLButtonElement>("button")!.click());
  await wait();
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("owner record");
  expect(load).toHaveBeenCalledTimes(2);
});

it("keeps verified cached records available when a background refresh fails", async () => {
  client.setQueryData(["records"], ["verified"]);
  function Destination() {
    const [records, , status] = useEntityStore(["records"], [], async () => { throw new Error("offline"); }, { seeded: false });
    return <DashboardDestinationBoundary statuses={[status]} onRetry={() => {}}><input aria-label="record" defaultValue={records[0]} /></DashboardDestinationBoundary>;
  }
  act(() => root.render(<QueryClientProvider client={client}><Destination /></QueryClientProvider>));
  await act(async () => { await client.refetchQueries({ queryKey: ["records"] }); });
  await wait();
  expect(host.querySelector<HTMLInputElement>("input")?.value).toBe("verified");
  expect(host.querySelector('[role="alert"]')).toBeNull();
});
