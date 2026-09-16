import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rejectCrossOrigin } from "@/lib/csrf";
import { linkPayment, runPaymentMatching } from "@/lib/payment-matching-server";

/**
 * The owner-facing half of payment matching: the "Match now" button and the
 * manual link on a leftover payment.
 *
 * Runs with the user's own session, so own-only RLS is the scope boundary and
 * there is no service-role client here. A manual link therefore cannot reach a
 * foreign invoice even if the id is guessed — the transactions update policy
 * checks the invoice's owner, and every statement carries `user_id` too.
 *
 * Body:
 *   { mode: "auto" }                                 run the matcher
 *   { mode: "link", transactionId, invoiceId }       link one payment by hand
 */

export const dynamic = "force-dynamic";

type Body = {
  mode?: "auto" | "link";
  transactionId?: string;
  invoiceId?: string;
};

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request);
  if (csrf) return csrf;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (body.mode === "link") {
    const transactionId = typeof body.transactionId === "string" ? body.transactionId : "";
    const invoiceId = typeof body.invoiceId === "string" ? body.invoiceId : "";
    if (!transactionId || !invoiceId) {
      return NextResponse.json({ error: "Missing transaction or invoice." }, { status: 400 });
    }

    // Read the payment first: its date becomes the invoice's paid_on, and a
    // payment that is already linked must not be silently re-pointed.
    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .select("id, kind, occurred_on, invoice_id")
      .eq("id", transactionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (txError) {
      return NextResponse.json({ error: "Could not read the payment." }, { status: 500 });
    }
    if (!tx) return NextResponse.json({ error: "Not found." }, { status: 404 });
    if (tx.kind !== "income") {
      return NextResponse.json({ error: "Only an incoming payment can settle an invoice." }, { status: 400 });
    }
    if (tx.invoice_id) {
      return NextResponse.json({ error: "That payment is already linked." }, { status: 409 });
    }

    const { data: invoice, error: invoiceError } = await supabase
      .from("invoices")
      .select("id, status")
      .eq("id", invoiceId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (invoiceError) {
      return NextResponse.json({ error: "Could not read the invoice." }, { status: 500 });
    }
    if (!invoice) return NextResponse.json({ error: "Not found." }, { status: 404 });

    const written = await linkPayment(supabase, user.id, {
      transactionId,
      invoiceId,
      paidOn: tx.occurred_on as string,
      source: "manual",
    });
    if (!written) {
      return NextResponse.json({ error: "Could not link the payment." }, { status: 409 });
    }
    return NextResponse.json({ ok: true, linked: 1, paidOn: tx.occurred_on });
  }

  const result = await runPaymentMatching(supabase, user.id);
  return NextResponse.json({
    ok: true,
    scanned: result.scanned,
    linked: result.linked,
    unmatched: result.unmatched.length,
  });
}
