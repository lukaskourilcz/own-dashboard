import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rejectCrossOrigin } from '@/lib/csrf';
import { AMBIENT_PERSONAS } from '@/lib/heydarlink/ambient-config';
import { ambientBatchCapUsd, openAmbientBatch } from '@/lib/heydarlink/ambient-batch';

export const runtime = 'nodejs';

/**
 * HeyDarlink ambient batches (owner decision, 8 November 2026). GET lists the recent batches with their frame counts
 * and cost; POST opens a batch for the named personas (all four by default): their whole shot list in 4:5 and 9:16,
 * under the batch cost cap. The marketing tick then works the frames behind HEYDARLINK_AMBIENT_ENABLED. Only the
 * signed-in owner can call either; nothing here renders, pays or uploads by itself.
 */
const Request_ = z.strictObject({ personas: z.array(z.enum(AMBIENT_PERSONAS)).min(1).max(4).optional() });
const headers = { 'Cache-Control': 'private, no-store' };

async function owner() {
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  return user;
}

export async function GET() {
  if (!(await owner())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const admin = createAdminClient();
  const batches = await admin.from('heydarlink_ambient_batches').select('id,persona,status,reason,cap_usd,created_at,finished_at').order('created_at', { ascending: false }).limit(20);
  if (batches.error) return NextResponse.json({ error: 'ambient-unavailable' }, { status: 503 });
  const ids = (batches.data ?? []).map((batch) => batch.id);
  const frames = ids.length ? await admin.from('heydarlink_ambient_frames').select('batch_id,status,cost_usd').in('batch_id', ids).limit(2000) : { data: [], error: null };
  if (frames.error) return NextResponse.json({ error: 'ambient-unavailable' }, { status: 503 });
  return NextResponse.json({ batches: (batches.data ?? []).map((batch) => {
    const own = (frames.data ?? []).filter((frame) => frame.batch_id === batch.id);
    const counts = Object.fromEntries([...new Set(own.map((frame) => frame.status))].map((status) => [status, own.filter((frame) => frame.status === status).length]));
    return { ...batch, frames: counts, costUsd: Number(own.reduce((sum, frame) => sum + Number(frame.cost_usd ?? 0), 0).toFixed(4)) };
  }) }, { headers });
}

export async function POST(request: Request) {
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  if (!(await owner())) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const input = Request_.safeParse(await request.json().catch(() => ({})));
  if (!input.success) return NextResponse.json({ error: 'ambient-request-invalid' }, { status: 400 });
  const admin = createAdminClient();
  const opened = [];
  try {
    for (const persona of input.data.personas ?? AMBIENT_PERSONAS) opened.push({ persona, ...(await openAmbientBatch(admin, persona, 'manual', ambientBatchCapUsd())) });
  } catch { return NextResponse.json({ error: 'ambient-unavailable' }, { status: 503 }); }
  return NextResponse.json({ batches: opened }, { headers });
}
