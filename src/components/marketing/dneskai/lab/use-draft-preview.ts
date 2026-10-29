'use client';

import { useEffect, useState } from 'react';
import { dneskaiWorkspaceApi, DneskaiWorkspaceRequestError } from '@/lib/marketing/dneskai-workspace-client';
import type { DneskaiPreviewRequest } from '@/lib/marketing/dneskai-lab';
import type { DneskaiStagePreview } from './stage';

/** At most sixteen real render-only previews per revision; failures retry only on explicit request. */
const PREVIEW_MEMORY = 16;
export function useDneskaiDraftPreview(previewKey: string | null, postId: string, demo: boolean) {
  const [previewMemory, setPreviewMemory] = useState<ReadonlyMap<string, DneskaiStagePreview>>(() => new Map());
  const [retryClock, setRetryClock] = useState(() => Date.now());
  const preview = previewKey ? previewMemory.get(previewKey) ?? { slide: JSON.parse(previewKey).slide as number, status: 'loading' as const, image: null, code: null } : null;
  const retryAt = preview?.retryAt ?? 0;
  useEffect(() => {
    if (!retryAt || retryClock >= retryAt) return;
    const timer = window.setTimeout(() => setRetryClock(Date.now()), Math.min(2_147_483_647, Math.max(0, retryAt - Date.now())));
    return () => window.clearTimeout(timer);
  }, [retryAt, retryClock]);
  const retryPreview = previewKey && preview?.status === 'unavailable' ? () => {
    if (Date.now() < retryAt) return;
    setPreviewMemory((before) => { const next = new Map(before); next.delete(previewKey); return next; });
  } : undefined;
  const remembered = previewKey ? previewMemory.has(previewKey) : true;
  useEffect(() => {
    if (!previewKey || remembered) return;
    const abort = new AbortController();
    const { deck, slide: index } = JSON.parse(previewKey) as { deck: DneskaiPreviewRequest['deck']; slide: number };
    const keep = (value: DneskaiStagePreview) => setPreviewMemory((before) => {
      const next = new Map(before).set(previewKey, value);
      while (next.size > PREVIEW_MEMORY) next.delete(next.keys().next().value!);
      return next;
    });
    // Debounced like the fit check, so typing renders once per pause, not per key.
    const timer = window.setTimeout(async () => {
      try {
        const result = await (await dneskaiWorkspaceApi(demo)).renderPreview({ id: postId, deck: deck!, slide: index }, abort.signal);
        if (!abort.signal.aborted) keep({ slide: index, status: result.status, image: result.image, code: result.problems.find((problem) => problem.blocking)?.code ?? null });
      } catch (failure) {
        if (abort.signal.aborted) return;
        // Keep the failed state until an explicit retry or edit; never retry in a loop.
        keep({ slide: index, status: 'unavailable', image: null, code: failure instanceof DneskaiWorkspaceRequestError ? failure.code : null, retryAt: failure instanceof DneskaiWorkspaceRequestError ? Date.now() + failure.retryAfterMs : 0 });
      }
    }, 450);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [previewKey, remembered, postId, demo]);

  return { preview, retryPreview, retryBlocked: retryClock < retryAt };
}
