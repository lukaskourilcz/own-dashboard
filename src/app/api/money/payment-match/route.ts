import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { linkPayment, readPaymentMatchingSnapshot, runPaymentMatching } from "@/lib/payment-matching-server";

export const dynamic = "force-dynamic";
const inputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("auto") }),
  z.object({ mode: z.literal("link"), transactionId: z.uuid(), invoiceId: z.uuid() }),
]);

/** Same-origin owner action. Snapshot identities and atomic settlement protect
 * both manual and scheduled writes; no service credential reaches this route.
 */
export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  const limited = await rateLimit(user.id, { key: "payment-match", limit: 10, windowSec: 60 });
  if (!limited.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429, headers: { "Retry-After": String(limited.retryAfter) } });
  try {
    const body = parsed.data;
    if (body.mode === "link") {
      const snapshot = await readPaymentMatchingSnapshot(supabase, user.id, body);
      const transaction = snapshot.transactions.find(row => row.id === body.transactionId);
      const invoice = snapshot.invoices.find(row => row.id === body.invoiceId);
      if (!transaction || !invoice) return NextResponse.json({ error: "Not found." }, { status: 404 });
      if (transaction.kind !== "income" || invoice.payment_method !== "bank") {
        return NextResponse.json({ error: "An incoming transfer and bank invoice are required." }, { status: 400 });
      }
      const receipt = await linkPayment(supabase, user.id, { invoice, transaction });
      if (!receipt) return NextResponse.json({ error: "The payment or invoice changed. Refresh before linking." }, { status: 409 });
      return NextResponse.json({ ok: true, linked: 1, paidOn: receipt.paid_on });
    }
    const result = await runPaymentMatching(supabase, user.id);
    return NextResponse.json({ ok: true, scanned: result.scanned, linked: result.linked, unmatched: result.unmatched.length });
  } catch {
    return NextResponse.json({ error: "Payment matching could not be confirmed. Refresh before retrying." }, { status: 500 });
  }
}
