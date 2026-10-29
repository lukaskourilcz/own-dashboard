"use client";

import { useState, type ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createDashboardQueryClient } from "@/lib/queries/client";
import { PostHogProvider } from "@/components/posthog-provider";

/** Root/public query context. The private shell uses a separate owner cache;
 * public tours also retain their own isolated GuestBoundary context. */
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(createDashboardQueryClient);
  return (
    <QueryClientProvider client={client}>
      <PostHogProvider>{children}</PostHogProvider>
    </QueryClientProvider>
  );
}
