// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { login } from "@/lib/i18n/sections/login";
const state = vi.hoisted(() => ({ oauth: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithOAuth: state.oauth } }) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
import LoginPage from "@/app/login/page";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined, host: HTMLDivElement;
afterEach(() => { act(() => root?.unmount()); host?.remove(); state.oauth.mockReset(); document.documentElement.lang = "cs"; });
for (const lang of ["en", "cs"] as const) it.each(["throw", "return"])(`${lang}: sign-in recovers from a %s failure without exposing provider details`, async mode => {
  document.documentElement.lang = lang; host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  let release!: () => void;
  state.oauth.mockImplementationOnce(() => new Promise((resolve, reject) => { release = () => mode === "throw" ? reject(new Error("Synthetic private provider detail")) : resolve({ error: new Error("Synthetic private provider detail") }); }));
  await act(async () => root!.render(<LoginPage />));
  const button = [...host.querySelectorAll("button")].find(button => button.textContent?.includes(login[lang].continueWithGoogle))!;
  await act(async () => button.click()); expect(button.disabled).toBe(true);
  await act(async () => release());
  expect(host.querySelector('[role="alert"]')?.textContent).toBe(login[lang].signInError); expect(host.textContent).not.toContain("private provider detail"); expect(button.disabled).toBe(false);
  state.oauth.mockResolvedValueOnce({ error: null });
  await act(async () => button.click()); expect(state.oauth).toHaveBeenCalledTimes(2); expect(button.disabled).toBe(true); expect(host.querySelector('[role="alert"]')).toBeNull();
  expect(state.oauth.mock.calls[1][0]).toMatchObject({ provider: "google", options: { scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile" } });
  expect(host.textContent?.split(login[lang].privateSystem)).toHaveLength(2);
});
