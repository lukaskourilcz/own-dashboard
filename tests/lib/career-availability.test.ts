import { afterEach, expect, it, vi } from "vitest";
import { verifyListings } from "@/lib/jobs/availability";
import type { JobListing } from "@/lib/types";
const jobs = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `job-${index}`, title: "React Engineer", url: `https://jobs.lever.co/example/${index}` })) as JobListing[];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it.each([100, 101, 105, 120])("makes at most 100 listing probes for %i inputs", async count => {
  const probe = vi.fn(async () => "open" as const);
  const result = await verifyListings(jobs(count), probe);
  expect(probe).toHaveBeenCalledTimes(100); expect(Object.keys(result)).toHaveLength(100); expect(result["job-100"]).toBeUndefined();
});
it("does not start a probe after caller cancellation", async () => {
  const controller = new AbortController(); controller.abort(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await verifyListings(jobs(1), undefined, controller.signal)).toEqual({}); expect(fetcher).not.toHaveBeenCalled();
});
it("returns unknown for in-flight work and starts no next batch when the total budget expires", async () => {
  const total = new AbortController(); vi.spyOn(AbortSignal, "timeout").mockImplementation(() => total.signal);
  const probe = vi.fn(() => new Promise<"open"> (() => undefined));
  const pending = verifyListings(jobs(100), probe); await vi.waitFor(() => expect(probe).toHaveBeenCalledTimes(15)); total.abort();
  const result = await pending; expect(Object.keys(result)).toHaveLength(15); expect(Object.values(result).every(value => value === "unknown")).toBe(true); expect(probe).toHaveBeenCalledTimes(15);
});
it("shares one listing deadline across redirects and releases redirect bodies", async () => {
  const cancelled = vi.fn(); const signals: AbortSignal[] = [];
  const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
    signals.push(init.signal as AbortSignal);
    return signals.length === 1 ? new Response(new ReadableStream({ cancel: cancelled }), { status: 302, headers: { location: "/example/redirected" } }) : new Response("React Engineer Apply now");
  }); vi.stubGlobal("fetch", fetcher);
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "open" }); expect(signals).toHaveLength(2); expect(signals[0]).toBe(signals[1]); expect(cancelled).toHaveBeenCalledOnce();
});
it("does not follow a redirect outside the approved public hosts", async () => {
  const cancelled = vi.fn(); const fetcher = vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel: cancelled }), { status: 302, headers: { location: "https://internal.example.test/private" } })); vi.stubGlobal("fetch", fetcher);
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" }); expect(fetcher).toHaveBeenCalledOnce(); expect(cancelled).toHaveBeenCalledOnce();
});
it("bounds stalled response headers and releases a late response without an unhandled rejection", async () => {
  const controller = new AbortController(), cancelled = vi.fn(); let release!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { release = resolve; })));
  const pending = verifyListings(jobs(1), undefined, controller.signal); await vi.waitFor(() => expect(release).toBeTypeOf("function")); controller.abort();
  expect(await pending).toEqual({ "job-0": "unknown" }); release(new Response(new ReadableStream({ cancel: cancelled })));
  await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce());
});
it("bounds a stalled body and never waits for a stalled cancellation hook", async () => {
  const controller = new AbortController(), cancelled = vi.fn(() => new Promise<void>(() => undefined));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel: cancelled }))));
  const pending = verifyListings(jobs(1), undefined, controller.signal); await new Promise(resolve => setTimeout(resolve, 0)); controller.abort();
  expect(await pending).toEqual({ "job-0": "unknown" }); expect(cancelled).toHaveBeenCalledOnce();
});
it("refuses a response beyond the byte ceiling and releases its remaining stream", async () => {
  const cancelled = vi.fn(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(1_500_001)); }, cancel: cancelled }))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" }); expect(cancelled).toHaveBeenCalledOnce();
});

const listingUrl = "https://jobs.lever.co/example/0";
const structuredPage = (value: unknown, text = "React Engineer Apply now") => `<script type="application/ld+json">${JSON.stringify(value)}</script>${text}`;
it.each([
  { "@type": "JobPosting", title: "Different role", url: listingUrl, validThrough: "2020-01-01" },
  { "@type": "JobPosting", title: "React Engineer", url: "https://jobs.lever.co/example/other", validThrough: "2020-01-01" },
  { "@type": "Event", title: "React Engineer", url: listingUrl, validThrough: "2020-01-01" },
  { validThrough: "2020-01-01" },
])("does not close the target from unrelated or unbound structured expiry (%j)", async evidence => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage(evidence))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "open" });
});
it("closes only matching JobPosting title and URL expiry, including a graph", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage({ "@graph": [{ "@type": ["JobPosting"], title: "REACT  Engineer", url: listingUrl, validThrough: "2020-01-01" }] }))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "closed" });
});
it("keeps conflicting matching structured expiry unknown", async () => {
  const posting = { "@type": "JobPosting", title: "React Engineer", url: listingUrl };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage([{ ...posting, validThrough: "2020-01-01" }, { ...posting, validThrough: "2099-01-01" }]))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});
it("a challenge page cannot establish closure from copied expired metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage({ "@type": "JobPosting", title: "React Engineer", url: listingUrl, validThrough: "2020-01-01" }, "Verify you are human"))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});
it("keeps mixed closed/apply signals unknown and ignores arbitrary script fields", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<script>{"validThrough":"2020-01-01"}</script>React Engineer Apply now. Related position is closed.')));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});
it("does not match different query identities or a redirected different listing", async () => {
  const job = { ...jobs(1)[0], url: listingUrl + "?position=one" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: listingUrl + "?position=two" } })).mockResolvedValueOnce(new Response(structuredPage({ "@type": "JobPosting", title: "React Engineer", url: listingUrl + "?position=two", validThrough: "2020-01-01" }))));
  expect(await verifyListings([job])).toEqual({ "job-0": "open" });
});
it("does not let a recommendation's JobPosting type establish an otherwise unconfirmed open state", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage({ "@type": "JobPosting", title: "Other Engineer", url: listingUrl + "/other" }, "React Engineer"))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});
it.each(["2026-10-25", "2026-10-25T12:00:00", "2026-02-30", "2026-02-30T12:00:00Z", "invalid"])("does not infer an early precise closure from an ambiguous expiry (%s)", async validThrough => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T18:00:00Z"));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage({ "@type": "JobPosting", title: "React Engineer", url: listingUrl, validThrough }))));
  expect((await verifyListings(jobs(1)))["job-0"]).toBe(validThrough === "2026-10-25" ? "open" : "unknown");
});
it("refuses incomplete structured traversal rather than taking an early expiry as complete evidence", async () => {
  const posting = { "@type": "JobPosting", title: "React Engineer", url: listingUrl, validThrough: "2020-01-01" };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(structuredPage([posting, ...Array.from({ length: 501 }, () => ({ "@type": "Thing" }))]))));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});

it("ignores an application phrase hidden in an arbitrary script", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('<script>const label = "Apply now";</script>React Engineer')));
  expect(await verifyListings(jobs(1))).toEqual({ "job-0": "unknown" });
});
