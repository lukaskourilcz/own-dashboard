'use client';

import { useEffect, useState } from 'react';
import { createDeckDraft, dneskaiEditRequest, dneskaiScheduleExpired, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiFitSlide } from '@/lib/marketing/dneskai-lab';
import { dneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import type { DneskaiFitState } from './slide-inspector';

/** One saved revision owns one edit session; changing revision identity remounts this hook. */
export function useDneskaiDraft(post: DneskaiWorkspacePost, accountId: string | null, preview: boolean, guest: boolean, onDirty: (dirty: boolean) => void) {
  const [draft, setDraft] = useState<DeckDraft>(() => createDeckDraft(post, accountId));
  const [fit, setFit] = useState<DneskaiFitState>({ status: 'idle', result: null });
  const [expired] = useState(() => dneskaiScheduleExpired(post));
  const request = (() => { try { return dneskaiEditRequest(post, draft, draft.accountId !== accountId ? draft.accountId : null); } catch { return null; } })();
  // Only a post that can still be edited has unsaved changes; once approved, the draft is no longer an edit.
  const editable = ['review', 'returned'].includes(post.status);
  const dirty = editable && (!request || !!request.deck || request.caption !== post.caption || Date.parse(request.scheduledAt) !== Date.parse(post.scheduledAt) || !!request.accountId || request.audioTrackId !== undefined || request.engagement !== undefined || request.format !== undefined);
  // Publish now replaces the time itself, so a draft that differs only in its time may use it.
  const onlyTimeChanged = !!request && !request.deck && request.caption === post.caption && !request.accountId && request.audioTrackId === undefined && request.engagement === undefined && request.format === undefined;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (guest) return;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const slides = draft.slides.map((item) => dneskaiFitSlide(item.slide));
        setFit({ status: 'checking', result: null });
        const result = await (await dneskaiWorkspaceApi(preview)).fit({ kit: draft.kit, slides }, abort.signal);
        if (!abort.signal.aborted) setFit({ status: 'ready', result });
      } catch { if (!abort.signal.aborted) setFit({ status: 'unavailable', result: null }); }
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [draft.slides, draft.kit, preview, guest]);
  return { draft, setDraft, fit, setFit, expired, request, editable, dirty, onlyTimeChanged };
}
