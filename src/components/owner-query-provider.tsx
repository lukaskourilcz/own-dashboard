'use client';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createDashboardQueryClient } from '@/lib/queries/client';
/** Owner identity namespaces the cache; this component grants no authority.
 * Only the enclosing server-verified scope may supply another owner. */
export function OwnerQueryProvider({ ownerId, children }: { ownerId: string; children: ReactNode }) {
 return <OwnerQueryScope key={ownerId}>{children}</OwnerQueryScope>;
}
function OwnerQueryScope({ children }: { children: ReactNode }) {
 const [client] = useState(createDashboardQueryClient), lifecycle = useRef({ epoch: 0 });
 useLayoutEffect(() => {
  const phase = lifecycle.current;
  phase.epoch++;
  return () => {
   const retired = ++phase.epoch;
   void client.cancelQueries().catch(() => undefined);
   // Strict Mode resumes this same instance immediately. Do not erase its
   // freshly remounted observers; a truly replaced owner has another client.
   queueMicrotask(() => { if (phase.epoch === retired) client.clear(); });
  };
 }, [client]);
 return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
