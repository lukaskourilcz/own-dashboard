import type { createClient } from "./client";

type BrowserClient = ReturnType<typeof createClient>;

/**
 * The current signed-in user's id, or null if there's no session. Wraps the
 * `supabase.auth.getUser()` → `data.user?.id` dance that every client mutation
 * repeated, so callers keep only their own "not signed in" handling:
 *
 *   const userId = await currentUserId(supabase);
 *   if (!userId) throw new Error("no-user");
 */
export async function currentUserId(
  supabase: BrowserClient,
): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}
