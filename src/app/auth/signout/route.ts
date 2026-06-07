import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { revokeGoogleAccess } from "@/lib/google-token";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    try {
      // Revoke Google grant + delete stored refresh token. Best-effort:
      // failures here shouldn't block sign-out.
      await revokeGoogleAccess(user.id);
    } catch (err) {
      console.error("[auth/signout] revokeGoogleAccess failed:", err);
    }
  }

  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
