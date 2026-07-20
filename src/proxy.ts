import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Skip the auth middleware for public metadata routes. These are fetched by
  // the browser/crawlers WITHOUT a session cookie, so running the auth redirect
  // on them 307'd `/manifest.webmanifest`, `/icon`, `/sitemap.xml` and
  // `/robots.txt` to `/login` — which is why the manifest failed to parse
  // ("Line 1, column 1, Syntax error": it got the login HTML, not JSON).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icon|apple-icon|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|webmanifest)$).*)",
  ],
};
