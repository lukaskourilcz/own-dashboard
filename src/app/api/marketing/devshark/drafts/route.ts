import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { rejectCrossOrigin } from '@/lib/csrf';
import { DevsharkSaveSchema } from '@/lib/marketing/devshark-studio';

export const runtime = 'nodejs';

/**
 * devShark concepts (owner request, 7 November 2026). GET lists the owner's concepts with their decision and plan
 * slot; POST records the owner's decision on one concept through marketing_devshark_decide, and PUT saves an edit through
 * marketing_devshark_save, which returns the concept to review. Only the signed-in owner can call either. Nothing here publishes: approved concepts wait for the plan step behind DEVSHARK_PLAN_ENABLED.
 */
const Decision = z.strictObject({ id: z.uuid(), decision: z.enum(['approved', 'rejected', 'draft']) });
const reasons: Record<string, string> = { 'draft unavailable': 'draft-unavailable', 'draft already planned': 'draft-already-planned', 'invalid decision': 'invalid-decision' };

export async function GET() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const [drafts, plan] = await Promise.all([
    db.from('marketing_devshark_drafts').select('id,title,deck,caption,origin,status,decided_at,created_at').eq('user_id', user.id).order('created_at', { ascending: false }).limit(100),
    db.from('marketing_devshark_plan').select('draft_id,date,local_time,instagram,threads,status,code').eq('user_id', user.id).order('date').limit(200),
  ]);
  if (drafts.error || plan.error) return NextResponse.json({ error: 'devshark-drafts-unavailable' }, { status: 503 });
  return NextResponse.json({ drafts: drafts.data, plan: plan.data }, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const input = Decision.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'invalid-decision' }, { status: 400 });
  const { data, error } = await db.rpc('marketing_devshark_decide', { p_draft: input.data.id, p_decision: input.data.decision });
  if (error) return NextResponse.json({ error: reasons[error.message] ?? 'decision-unavailable' }, { status: 409 });
  return NextResponse.json({ id: input.data.id, status: data });
}

export async function PUT(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const input = DevsharkSaveSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'invalid-draft' }, { status: 400 });
  const { error } = await db.rpc('marketing_devshark_save', { p_draft: input.data.id, p_title: input.data.title, p_deck: input.data.deck, p_caption: input.data.caption });
  if (error) return NextResponse.json({ error: reasons[error.message] ?? 'save-unavailable' }, { status: 409 });
  return NextResponse.json({ id: input.data.id, status: 'draft' });
}
