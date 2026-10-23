import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { dneskaiEngagementWatchEnabled } from '@/lib/marketing/dneskai-engagement';
import { handleDneskaiCommentEvents } from '@/lib/marketing/dneskai-engagement-watch';
import { createDneskaiEngagementGraph, createDneskaiEngagementStore } from '@/lib/marketing/dneskai-engagement-ports';
import { INSTAGRAM_WEBHOOK_MAX_BYTES, instagramCommentEvents, instagramWebhookSignatureValid } from '@/lib/marketing/dneskai-instagram-webhook';

/**
 * Instagram comment webhook (#161), the upgrade over the comment watcher's polling (#160).
 *
 * GET answers Meta's subscription check: `hub.challenge` when `hub.verify_token` equals
 * MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN. POST checks `X-Hub-Signature-256` against MARKETING_INSTAGRAM_APP_SECRET
 * (MARKETING_META_APP_SECRET under Facebook Login, #216),
 * answers 200 at once and hands the comments to the same matcher and one-reply claim as polling through `after()`, so a
 * comment delivered twice, or seen by polling too, is answered once. Off (404) unless DNESKAI_ENGAGEMENT_ENABLED and
 * both values are set; the replies go to the marketing owner's DNESKAi account (MARKETING_OWNER_ID).
 */
export const runtime = 'nodejs';
export const maxDuration = 30;

function configured(env: Record<string, string | undefined>) {
  // #216: under Facebook Login Meta signs with the Meta app's own secret; under Instagram Login with the Instagram app secret.
  const facebook = env.MARKETING_DNESKAI_INSTAGRAM_LOGIN_MODE === 'facebook';
  const verifyToken = env.MARKETING_INSTAGRAM_WEBHOOK_VERIFY_TOKEN ?? '', secret = (facebook ? env.MARKETING_META_APP_SECRET : env.MARKETING_INSTAGRAM_APP_SECRET) ?? '', owner = env.MARKETING_OWNER_ID ?? '';
  if (!dneskaiEngagementWatchEnabled(env) || verifyToken.length < 16 || secret.length < 16 || !/^[0-9a-f-]{36}$/i.test(owner)) return null;
  return { verifyToken, secret, owner };
}

export async function GET(request: Request) {
  const settings = configured(process.env);
  if (!settings) return new Response(null, { status: 404 });
  const query = new URL(request.url).searchParams;
  const challenge = query.get('hub.challenge') ?? '';
  if (query.get('hub.mode') !== 'subscribe' || query.get('hub.verify_token') !== settings.verifyToken || !/^[\w-]{1,200}$/.test(challenge)) return new Response(null, { status: 403 });
  return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } });
}

export async function POST(request: Request) {
  const settings = configured(process.env);
  if (!settings) return new Response(null, { status: 404 });
  if (Number(request.headers.get('content-length') ?? 0) > INSTAGRAM_WEBHOOK_MAX_BYTES) return new Response(null, { status: 413 });
  const raw = await request.text();
  if (raw.length > INSTAGRAM_WEBHOOK_MAX_BYTES) return new Response(null, { status: 413 });
  if (!instagramWebhookSignatureValid(raw, request.headers.get('x-hub-signature-256'), settings.secret)) return new Response(null, { status: 401 });
  let body: unknown = null;
  try { body = JSON.parse(raw); } catch { body = null; }
  const events = instagramCommentEvents(body);
  if (events.length) {
    after(async () => {
      try {
        const db = createAdminClient();
        await handleDneskaiCommentEvents({ store: createDneskaiEngagementStore(db, settings.owner), graph: createDneskaiEngagementGraph(db, settings.owner, process.env),
          now: () => new Date(), signal: AbortSignal.timeout(25_000), events });
      } catch { /* polling picks the comment up on the next tick; the claim keeps it to one reply */ }
    });
  }
  return new Response(null, { status: 200 });
}
