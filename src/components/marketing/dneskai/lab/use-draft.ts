'use client';

import { useEffect, useState } from 'react';
import { createDeckDraft, dneskaiEditRequest, dneskaiScheduleExpired, type DeckDraft } from '@/lib/marketing/dneskai-deck-editor';
import { DneskaiFitRequestSchema, dneskaiFitSlide } from '@/lib/marketing/dneskai-lab';
import { dneskaiWorkspaceApi } from '@/lib/marketing/dneskai-workspace-client';
import type { DneskaiWorkspacePost } from '@/lib/marketing/dneskai-workspace';
import type { DneskaiFitState } from './slide-inspector';

/** One saved revision owns one edit session; changing revision identity remounts this hook. */
export function useDneskaiDraft(post: DneskaiWorkspacePost, accountId: string | null, preview: boolean, guest: boolean, onDirty: (dirty: boolean) => void) {
  const [draft, setDraft] = useState<DeckDraft>(() => createDeckDraft(post, accountId));
  // Crop, image identity and alt text do not enter the pure text/layout fit.
  // Bind feedback to that exact input, independently of the slide object identity.
  const fitKey = (() => { try { return JSON.stringify({ kit: draft.kit, slides: draft.slides.map((item) => dneskaiFitSlide(item.slide)) }); } catch { return null; } })();
  const [fitted, setFitted] = useState<{ key: string | null; state: DneskaiFitState }>(() => ({ key: fitKey, state: { status: 'idle', result: null } }));
  const fit: DneskaiFitState = fitKey === null ? { status: 'unavailable', result: null } : fitted.key === fitKey ? fitted.state : { status: 'checking', result: null };
  const expired = dneskaiScheduleExpired(post);
  const request = (() => { try { return dneskaiEditRequest(post, draft, draft.accountId !== accountId ? draft.accountId : null); } catch { return null; } })();
  // Only a post that can still be edited has unsaved changes; once approved, the draft is no longer an edit.
  const editable = ['review', 'returned'].includes(post.status);
  const dirty = editable && (!request || !!request.deck || request.caption !== post.caption || Date.parse(request.scheduledAt) !== Date.parse(post.scheduledAt) || !!request.accountId || request.audioTrackId !== undefined || request.engagement !== undefined || request.format !== undefined);
  // Publish now replaces the time itself, so a draft that differs only in its time may use it.
  const onlyTimeChanged = !!request && !request.deck && request.caption === post.caption && !request.accountId && request.audioTrackId === undefined && request.engagement === undefined && request.format === undefined;
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
  useEffect(() => {
    if (guest || fitKey === null) return;
    const abort = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const input = DneskaiFitRequestSchema.parse(JSON.parse(fitKey));
        setFitted({ key: fitKey, state: { status: 'checking', result: null } });
        const result = await (await dneskaiWorkspaceApi(preview)).fit(input, abort.signal);
        if (!abort.signal.aborted) setFitted({ key: fitKey, state: { status: 'ready', result } });
      } catch { if (!abort.signal.aborted) setFitted({ key: fitKey, state: { status: 'unavailable', result: null } }); }
    }, 300);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [fitKey, preview, guest]);
  return { draft, setDraft, fit, expired, request, editable, dirty, onlyTimeChanged };
}
