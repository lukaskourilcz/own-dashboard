import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

  const { data: banks } = await supabase.from("bank_connections").select("status,last_synced_at,institution_name").eq("user_id", user.id);
  let google = false;
  let github = false;
  try {
    const admin = createAdminClient();
    const [googleResult, githubResult] = await Promise.all([
      admin.from("google_oauth").select("user_id").eq("user_id", user.id).maybeSingle(),
      admin.from("github_tokens").select("user_id").eq("user_id", user.id).maybeSingle(),
    ]);
    google = Boolean(googleResult.data);
    github = Boolean(githubResult.data);
  } catch {
    // Local environments without a service-role key can still report the
    // user's own bank rows and configured provider availability.
  }

  return NextResponse.json({
    google: { connected: google, configured: Boolean(process.env.GOOGLE_OAUTH_CLIENT_ID && process.env.GOOGLE_OAUTH_CLIENT_SECRET) },
    github: { connected: github, configured: Boolean(process.env.GITHUB_OAUTH_CLIENT_ID && process.env.GITHUB_OAUTH_CLIENT_SECRET) },
    bank: { connected: (banks ?? []).some((item) => item.status === "linked"), configured: Boolean(process.env.GOCARDLESS_SECRET_ID && process.env.GOCARDLESS_SECRET_KEY), last_synced_at: (banks ?? []).map((item) => item.last_synced_at).filter(Boolean).sort().at(-1) ?? null },
    email: { configured: Boolean(process.env.RESEND_API_KEY) },
  }, { headers: { "cache-control": "private, no-store" } });
}
