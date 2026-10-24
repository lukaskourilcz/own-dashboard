import { renderAppIcon } from "@/lib/brand-icon";

export const dynamic = "force-static";

export function GET() {
  return renderAppIcon(192);
}
