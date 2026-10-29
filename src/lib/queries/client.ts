'use client';
import { QueryClient } from '@tanstack/react-query';
/** Shared behavior for root/public and separate private-owner caches. */
export function createDashboardQueryClient() {
 return new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });
}
