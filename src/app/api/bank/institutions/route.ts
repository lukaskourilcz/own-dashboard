import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isGoCardlessConfigured, listInstitutions } from "@/lib/gocardless";

/**
 * List the banks available for a country (default Czech Republic) so the UI can
 * render a picker. Requires a signed-in user; returns a trimmed shape.
 */
export async function GET(request: Request) {
  if (!isGoCardlessConfigured()) {
    return NextResponse.json({ error: "not-configured" }, { status: 503 });
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  const country = (new URL(request.url).searchParams.get("country") ?? "cz")
    .slice(0, 2)
    .toLowerCase();

  try {
    const institutions = await listInstitutions(country);
    return NextResponse.json({
      institutions: institutions.map((i) => ({
        id: i.id,
        name: i.name,
        bic: i.bic ?? null,
        logo: i.logo ?? null,
      })),
    });
  } catch (err) {
    console.error("[api/bank/institutions] failed:", err);
    return NextResponse.json(
      { error: "Could not load banks." },
      { status: 502 },
    );
  }
}
