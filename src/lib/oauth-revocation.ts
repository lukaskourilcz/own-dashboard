import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { awaitWithSignal } from "@/lib/abortable";
import type { OAuthProvider } from "@/lib/oauth-access-token";

const credential = z.string().min(1).max(8192).regex(/^\S+$/);
const claimSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("disconnected") }), z.object({ state: z.literal("busy") }),
  z.object({ state: z.literal("claimed"), lease_id: z.uuid(), row: z.object({ user_id: z.string(), access_token: credential.nullable(), refresh_token: credential.nullable() }) }),
]);
export type RevocationReceipt = { upstreamRevoked: boolean };

/** Local removal and upstream revocation have independent receipts. Never
 * delete a newer login grant, or place a credential in a REST filter URL. */
export async function revokeOAuthGrant(provider: OAuthProvider, userId: string, parent?: AbortSignal): Promise<RevocationReceipt> {
  try {
    const signal = AbortSignal.any([AbortSignal.timeout(20_000), ...(parent ? [parent] : [])]);
    const admin = createAdminClient(signal);
    const claimed = await awaitWithSignal(admin.rpc("claim_oauth_revocation", { p_user_id: userId, p_provider: provider }).abortSignal(signal), signal);
    if (claimed.error) throw Error();
    const claim = claimSchema.parse(claimed.data);
    if (claim.state === "disconnected") return { upstreamRevoked: false };
    if (claim.state === "busy" || claim.row.user_id !== userId) throw Error();
    let upstreamRevoked = false;
    const upstreamSignal = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
    try {
      let response: Response | null = null;
      if (provider === "google") {
        if (!claim.row.refresh_token) throw Error();
        response = await awaitWithSignal(fetch("https://oauth2.googleapis.com/revoke", {
          method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: claim.row.refresh_token }), redirect: "error", cache: "no-store", signal: upstreamSignal,
        }), upstreamSignal);
      } else {
        const id = process.env.GITHUB_OAUTH_CLIENT_ID, secret = process.env.GITHUB_OAUTH_CLIENT_SECRET;
        if (id && secret && claim.row.access_token) {
          response = await awaitWithSignal(fetch(`https://api.github.com/applications/${encodeURIComponent(id)}/grant`, {
            method: "DELETE", headers: { Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
              Accept: "application/vnd.github+json", "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
            body: JSON.stringify({ access_token: claim.row.access_token }), redirect: "error", cache: "no-store", signal: upstreamSignal,
          }), upstreamSignal);
        }
      }
      upstreamRevoked = response?.ok === true;
      void response?.body?.cancel().catch(() => undefined);
    } catch { /* Preserve the explicit local-disconnect behavior; report the upstream uncertainty. */ }
    signal.throwIfAborted();
    const completion = await awaitWithSignal(admin.rpc("complete_oauth_revocation", {
      p_user_id: userId, p_provider: provider, p_lease_id: claim.lease_id,
    }).abortSignal(signal), signal);
    if (completion.error || completion.data !== true) throw Error();
    return { upstreamRevoked };
  } catch { throw new Error("OAuth removal unconfirmed"); }
}
