"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

/**
 * App-wide React Query provider. One QueryClient per browser session (stable
 * across re-renders and client navigations) so the cache — which now backs the
 * whole dashboard's data — survives tab switches. Mounted at the root so every
 * client component can use queries/mutations.
 */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: 1, refetchOnWindowFocus: false },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
