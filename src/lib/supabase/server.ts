import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { fetchWithSignal } from "@/lib/abortable";

export async function createClient(signal?: AbortSignal, fetcher?: typeof fetch) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...((signal || fetcher) ? { global: { fetch: signal ? fetchWithSignal(signal, fetcher) : fetcher } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          if (signal?.aborted) return;
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    },
  );
}
