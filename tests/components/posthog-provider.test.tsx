// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sdk = { __loaded: false, init: vi.fn() };
let root: Root | undefined, host: HTMLDivElement, directory: string;
const state = { imports: 0, sdk };
beforeEach(async () => {
  state.imports = 0; sdk.__loaded = false; sdk.init.mockReset().mockImplementation(() => { sdk.__loaded = true; });
  vi.stubGlobal("__auditPostHog", state);
  directory = await mkdtemp(join(process.cwd(), "node_modules/.audit-posthog-"));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { act(() => root?.unmount()); host?.remove(); vi.unstubAllGlobals(); if (directory) await rm(directory, { recursive: true, force: true }); });

/** Compile the lazy boundary with an isolated SDK module. This avoids the
 * runner's dual CommonJS entry interop invoking the actual analytics library. */
const render = async (key: string) => {
  const outfile = join(directory, "provider.mjs");
  await build({ entryPoints: ["src/components/posthog-provider.tsx"], outfile, bundle: true, format: "esm", platform: "node", jsx: "automatic",
    external: ["react", "react/jsx-runtime"], define: { "process.env.NEXT_PUBLIC_POSTHOG_KEY": JSON.stringify(key), "process.env.NEXT_PUBLIC_POSTHOG_HOST": "undefined" },
    plugins: [{ name: "isolated-analytics", setup(builder) {
      builder.onResolve({ filter: /^posthog-js$/ }, () => ({ path: "sdk", namespace: "isolated-sdk" }));
      builder.onLoad({ filter: /.*/, namespace: "isolated-sdk" }, () => ({ contents: "globalThis.__auditPostHog.imports++; export default globalThis.__auditPostHog.sdk;" }));
    } }],
  });
  const { PostHogProvider } = await import(/* @vite-ignore */ pathToFileURL(outfile).href);
  await act(async () => root!.render(<StrictMode><PostHogProvider><button>Available application</button></PostHogProvider></StrictMode>));
  expect(host.querySelector("button")?.textContent).toBe("Available application");
};
it("does not load or initialize the SDK when optional analytics is unconfigured", async () => {
  await render(""); expect(state.imports).toBe(0); expect(sdk.init).not.toHaveBeenCalled();
});
it("loads configured analytics once under Strict Mode without delaying the app", async () => {
  await render("synthetic-public-analytics-project");
  expect(state.imports).toBe(1); expect(sdk.init).toHaveBeenCalledTimes(1);
  expect(sdk.init).toHaveBeenCalledWith("synthetic-public-analytics-project", expect.objectContaining({
    api_host: "https://eu.i.posthog.com", persistence: "localStorage", person_profiles: "identified_only",
    capture_pageview: true, capture_pageleave: true, autocapture: true, disable_session_recording: false,
    session_recording: { maskAllInputs: true, maskTextSelector: "*" },
  }));
});
it("keeps the app available after optional analytics initialization fails", async () => {
  sdk.init.mockImplementation(() => { throw new Error("Synthetic SDK failure"); });
  await render("synthetic-public-analytics-project"); expect(sdk.init).toHaveBeenCalledTimes(1);
});
