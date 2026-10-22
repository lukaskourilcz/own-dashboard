import { rejectCrossOrigin } from '@/lib/csrf';
import { dneskaiFitResponse } from '@/lib/marketing/dneskai-fit';

export const runtime = 'nodejs';

/**
 * The Design Lab's fit feedback for the fixture-only `/dev-preview` harness: the same pure fit as
 * POST /api/marketing/dneskai/fit, without a session because the preview has none. It reads no owner data and writes
 * nothing. Like the preview page, it exists only in development and explicit NEXT_E2E builds; production answers 404.
 */
export async function POST(request: Request) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_E2E !== '1') return Response.json({ error: 'not-found' }, { status: 404 });
  const csrf = rejectCrossOrigin(request); if (csrf) return csrf;
  return dneskaiFitResponse(request);
}
