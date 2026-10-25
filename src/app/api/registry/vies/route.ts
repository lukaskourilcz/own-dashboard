import { registryLookup } from "@/lib/tax-registry-server";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/** Read-only public lookup; owned persistence remains a separate browser action. */
export async function POST(request: Request) { return registryLookup(request, "vies"); }
