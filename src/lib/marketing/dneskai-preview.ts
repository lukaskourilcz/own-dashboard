import 'server-only';
import type { DneskaiDeck } from './dneskai-slides';
import type { LoadDneskaiMediaBytes } from './dneskai-ports';
import { DneskaiRenderError, previewDneskaiSlide } from './dneskai-render';
import { DNESKAI_PREVIEW_VERSION, DneskaiPreviewResultSchema, type DneskaiPreviewResult } from './dneskai-lab';

/**
 * The Design Lab's render-only preview (REN-01), shared by the owner's route and the fixture-only `/dev-preview`
 * twin. One slide of an edited deck through the real studio and OwnDashboard's gate, in memory: $0 (no model call),
 * no write to `marketing-assets`, no revision, no content hash. Its time is bounded like the save's render: the
 * route passes an abort signal with its budget and an abort is `worker-timeout`.
 */
export const DNESKAI_PREVIEW_BUDGET_MS = 8_000;

export async function dneskaiPreviewResponse(deck: DneskaiDeck, slide: number, loadMedia: LoadDneskaiMediaBytes, signal: AbortSignal): Promise<Response> {
  if (slide >= deck.slides.length) return Response.json({ error: 'preview-slide-invalid' }, { status: 400 });
  try {
    const preview = await previewDneskaiSlide(deck, slide, loadMedia, { signal });
    const result: DneskaiPreviewResult = DneskaiPreviewResultSchema.parse({
      schemaVersion: DNESKAI_PREVIEW_VERSION, draft: true, slide, status: preview.status,
      image: preview.image ? `data:image/webp;base64,${preview.image.toString('base64')}` : null,
      // Codes and fields only: a problem's English message stays on the server, the Lab words the code itself.
      problems: preview.problems.slice(0, 30).map(({ code, field, blocking }) => ({ code, field: field?.slice(0, 80) ?? null, blocking })),
    });
    return Response.json(result, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const code = error instanceof DneskaiRenderError ? error.code : 'render-unavailable';
    return Response.json({ error: code }, { status: code === 'worker-timeout' ? 504 : code === 'render-input-invalid' ? 400 : 503 });
  }
}
