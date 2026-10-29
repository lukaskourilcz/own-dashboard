import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { build } from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const state = { imports: 0, init: vi.fn(), request: vi.fn(), navigation: vi.fn(), message: vi.fn() };
let directory: string;
beforeEach(async () => { state.imports = 0; for (const fn of [state.init, state.request, state.navigation, state.message]) fn.mockReset(); vi.stubGlobal("__sentryAudit", state); directory = await mkdtemp(join(process.cwd(), "node_modules/.audit-sentry-")); });
afterEach(async () => { vi.unstubAllGlobals(); if (directory) await rm(directory, { recursive: true, force: true }); });
async function load(entry: string, serverDsn = "", publicDsn = "", runtime = "nodejs") {
  const outfile = join(directory, entry.replace(/[^a-z0-9]/gi, "-") + ".mjs");
  await build({ entryPoints: [entry], outfile, bundle: true, format: "esm", platform: "node", define: {
    "process.env.SENTRY_DSN": JSON.stringify(serverDsn), "process.env.NEXT_PUBLIC_SENTRY_DSN": JSON.stringify(publicDsn), "process.env.NEXT_RUNTIME": JSON.stringify(runtime),
  }, plugins: [{ name: "isolated-monitoring", setup(builder) {
    builder.onResolve({ filter: /^@\// }, args => ({ path: join(process.cwd(), "src", args.path.slice(2) + ".ts") }));
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "empty", namespace: "audit" }));
    builder.onResolve({ filter: /^@sentry\/nextjs$/ }, () => ({ path: "sdk", namespace: "audit" }));
    builder.onLoad({ filter: /.*/, namespace: "audit" }, args => ({ contents: args.path === "empty" ? "" : `
      globalThis.__sentryAudit.imports++;
      export const init=(...a)=>globalThis.__sentryAudit.init(...a);
      export const captureRequestError=(...a)=>globalThis.__sentryAudit.request(...a);
      export const captureRouterTransitionStart=(...a)=>globalThis.__sentryAudit.navigation(...a);
      export const captureMessage=(...a)=>globalThis.__sentryAudit.message(...a);` }));
  } }] });
  return import(/* @vite-ignore */ pathToFileURL(outfile).href);
}
it("does not initialize the SDK through server hooks or Calendar diagnostics when unconfigured", async () => {
  const server = await load("instrumentation.ts"); await server.register(); await server.onRequestError(new Error("Synthetic failure"), {}, {});
  const diagnostic = await load("src/lib/sentry-server.ts"); await diagnostic.captureCalendarRejection("POST", 500);
  expect(state.imports).toBe(0); expect(state.init).not.toHaveBeenCalled(); expect(state.request).not.toHaveBeenCalled(); expect(state.message).not.toHaveBeenCalled();
});
it.each(["nodejs", "edge"])("initializes configured %s diagnostics with explicit privacy controls", async runtime => {
  const server = await load("instrumentation.ts", "synthetic-server-dsn", "", runtime); await server.register();
  expect(state.imports).toBe(1); expect(state.init).toHaveBeenCalledOnce();
  expect(state.init.mock.calls[0][0]).toMatchObject({ dsn: "synthetic-server-dsn", tracesSampleRate: 0.1, dataCollection: { httpBodies: [], cookies: false, httpHeaders: false, databaseQueryData: false, genAI: { inputs: false, outputs: false } } });
  state.request.mockRejectedValueOnce(new Error("Synthetic diagnostics failure")); await expect(server.onRequestError(new Error("Synthetic original error"), {}, {})).resolves.toBeUndefined();
});
it("keeps the client SDK deferred and routing available without a public DSN", async () => {
  const client = await load("instrumentation-client.ts"); client.onRouterTransitionStart("/projects/private-name?token=synthetic-private", "push"); await new Promise(resolve => setTimeout(resolve, 0));
  expect(state.imports).toBe(0); expect(state.navigation).not.toHaveBeenCalled();
});
it("initializes configured client diagnostics without replay and sanitizes navigation", async () => {
  const client = await load("instrumentation-client.ts", "", "synthetic-public-dsn"); await vi.waitFor(() => expect(state.init).toHaveBeenCalledOnce());
  expect(state.init.mock.calls[0][0]).toMatchObject({ tracesSampleRate: 0.1, replaysSessionSampleRate: 0, replaysOnErrorSampleRate: 0 });
  expect(state.init.mock.calls[0][0]).not.toHaveProperty("integrations"); client.onRouterTransitionStart("/projects/private-name?token=synthetic-private", "push");
  await vi.waitFor(() => expect(state.navigation).toHaveBeenCalledWith("/projects/[project]", "push")); expect(state.imports).toBe(1);
});
it("keeps client startup and server startup available when optional initialization fails", async () => {
  state.init.mockImplementation(() => { throw new Error("Synthetic initialization failure"); });
  const client = await load("instrumentation-client.ts", "", "synthetic-public-dsn"); await vi.waitFor(() => expect(state.init).toHaveBeenCalledOnce()); client.onRouterTransitionStart("/", "push");
  const server = await load("instrumentation.ts", "synthetic-server-dsn"); await expect(server.register()).resolves.toBeUndefined();
});
it("limits an explicit Calendar diagnostic to its fixed code and status", async () => {
  const diagnostic = await load("src/lib/sentry-server.ts", "synthetic-server-dsn"); await diagnostic.captureCalendarRejection("DELETE", 500);
  expect(state.message).toHaveBeenCalledWith("calendar.event.DELETE upstream rejected", { level: "error", extra: { status: 500 } });
});
