"use client";

import { StorageClient } from "@supabase/storage-js";
import { fetchWithSignal } from "@/lib/abortable";
import { createBrowserClient } from "@supabase/ssr";
import { dashboardBrowserFetch } from "@/lib/guest-requests";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: dashboardBrowserFetch } },
  );
}


/** Signed uploads use their narrow server-issued authority, not a persisted owner session.
 * A fresh transport keeps cancellation out of the shared browser client. */
export function createSignedStorageClient(signal: AbortSignal) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  return new StorageClient(
    `${url.replace(/\/$/, "")}/storage/v1`,
    { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! },
    fetchWithSignal(signal, dashboardBrowserFetch),
  );
}
