import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("404"); } }));
vi.mock("@/components/demo-dashboard", () => ({ DemoDashboard: () => null }));
vi.mock("@/components/guest-boundary", () => ({ GuestBoundary: () => null }));
import PreviewPage from "@/app/dev-preview/page";
import { DemoDashboard } from "@/components/demo-dashboard";
import { GuestBoundary } from "@/components/guest-boundary";
afterEach(() => vi.unstubAllEnvs());

it("allows explicitly mocked mutation requests only with the nonexistent fixture backend", async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  expect((await PreviewPage({ searchParams: Promise.resolve({}) })).type).toBe(DemoDashboard);
});
it("isolates the developer's real backend from fixture interactions", async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.example");
  expect((await PreviewPage({ searchParams: Promise.resolve({}) })).type).toBe(GuestBoundary);
});
it("retains the ordinary production 404 even with a fixture backend", async () => {
  vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("NEXT_E2E", undefined); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  await expect(PreviewPage({ searchParams: Promise.resolve({}) })).rejects.toThrow("404");
});
it("enables repository interaction fixtures only against the nonexistent backend", async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  expect((await PreviewPage({ searchParams: Promise.resolve({ repositories: "live" }) })).props.liveRepositories).toBe(true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.example");
  expect((await PreviewPage({ searchParams: Promise.resolve({ repositories: "live" }) })).props.children.props.liveRepositories).toBe(false);
});

it("enables Music fixtures separately and only against the nonexistent backend", async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  expect((await PreviewPage({ searchParams: Promise.resolve({ music: "live" }) })).props.liveMusic).toBe(true);
  expect((await PreviewPage({ searchParams: Promise.resolve({ projectRecords: "live" }) })).props.liveMusic).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.example");
  expect((await PreviewPage({ searchParams: Promise.resolve({ music: "live" }) })).props.children.props.liveMusic).toBe(false);
});

it("isolates the live weekly-planning harness from other preview scopes and real backends", async () => {
  vi.stubEnv("NODE_ENV", "test"); vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  expect((await PreviewPage({ searchParams: Promise.resolve({ planning: "live" }) })).props.livePlanning).toBe(true);
  expect((await PreviewPage({ searchParams: Promise.resolve({ music: "live", projectRecords: "live" }) })).props.livePlanning).toBe(false);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://backend.example");
  expect((await PreviewPage({ searchParams: Promise.resolve({ planning: "live" }) })).props.children.props.livePlanning).toBe(false);
});

it("isolates task-write fixtures from other preview scopes and real backends", async () => {
 vi.stubEnv("NODE_ENV", "test");vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
 expect((await PreviewPage({searchParams:Promise.resolve({tasks:"live"})})).props.liveTasks).toBe(true);
 expect((await PreviewPage({searchParams:Promise.resolve({planning:"live",projectRecords:"live"})})).props.liveTasks).toBe(false);
 vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL","https://backend.example");
 expect((await PreviewPage({searchParams:Promise.resolve({tasks:"live"})})).props.children.props.liveTasks).toBe(false);
});
