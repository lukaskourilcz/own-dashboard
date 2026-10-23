"use client";

import { useLayoutEffect, useState, type ReactNode, type SyntheticEvent } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { guestProtectedUrl, guestReadOnlyResponse } from "@/lib/guest-requests";
import { useDict } from "@/lib/i18n";

/** Network and cache isolation, independent of each panel's preview UI. */
export function GuestBoundary({ children }: { children: ReactNode }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } }));
  const [blocked, setBlocked] = useState(false);
  const t = useDict().guest;
  const protects = (url: string) => guestProtectedUrl(url, window.location.origin, process.env.NEXT_PUBLIC_SUPABASE_URL);

  useLayoutEffect(() => {
    const original = window.fetch;
    const previousMarker = document.documentElement.dataset.guestTour;
    document.documentElement.dataset.guestTour = "true";
    const guarded: typeof fetch = (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (guestProtectedUrl(url, window.location.origin, process.env.NEXT_PUBLIC_SUPABASE_URL)) return Promise.resolve(guestReadOnlyResponse());
      return original.call(window, input, init);
    };
    window.fetch = guarded;
    const announce = () => setBlocked(true);
    window.addEventListener("guest-action-blocked", announce);
    return () => {
      if (window.fetch === guarded) window.fetch = original;
      if (previousMarker === undefined) delete document.documentElement.dataset.guestTour;
      else document.documentElement.dataset.guestTour = previousMarker;
      window.removeEventListener("guest-action-blocked", announce);
      client.clear();
    };
  }, [client]);

  function block(event: SyntheticEvent, url: string) {
    if (!protects(url)) return;
    event.preventDefault();
    event.stopPropagation();
    setBlocked(true);
  }

  return <QueryClientProvider client={client}>
    <div data-guest-boundary onClickCapture={event => {
      const anchor = (event.target as Element).closest("a[href]");
      if (anchor) block(event, (anchor as HTMLAnchorElement).href);
    }} onSubmitCapture={event => block(event, (event.target as HTMLFormElement).action)}>
      {children}
    </div>
    {blocked && <p role="status" className="pointer-events-none fixed inset-x-3 bottom-20 z-50 mx-auto max-w-md rounded-md border border-border bg-surface px-4 py-3 text-sm text-foreground shadow-elevated">{t.readOnlyAction}</p>}
  </QueryClientProvider>;
}
