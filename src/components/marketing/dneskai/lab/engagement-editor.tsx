'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { dneskaiLab as copy } from '@/lib/i18n/sections/dneskai-lab';
import { ENGAGEMENT_KEYWORD_PATTERN, ENGAGEMENT_PUBLIC_REPLY_MAX, ENGAGEMENT_REPLY_MESSAGE_MAX } from '@/lib/marketing/contracts';
import { dneskaiEngagementKeyword, newEngagementDraft, type DeckDraft, type EngagementDraft } from '@/lib/marketing/dneskai-deck-editor';
import { dneskaiCaptionWithKeyword } from '@/lib/marketing/dneskai-caption';
import { cn } from '@/lib/utils';
import { CountedField } from '../counted-field';

/**
 * „Komentář a zpráva“ (#159): the comment keyword, the DM text a keyword comment receives and the public reply under
 * the comment. The draft holds them as typed; the edit request sends them normalised, and only when they changed, so
 * a change makes a new version that needs its own approval. A post without a keyword (news) offers to add one.
 */
export function DneskaiEngagementEditor({ id, draft, onDraft: setDraft, handle, lang }: { id: string; draft: DeckDraft; onDraft: (next: DeckDraft) => void; handle: string; lang: 'en' | 'cs' }) {
  const t = copy[lang].engagement;
  // #158: the caption's code-written keyword line follows a valid keyword, and goes with a removed one.
  const onDraft = (next: DeckDraft) => {
    const keyword = next.engagement ? dneskaiEngagementKeyword(next.engagement.keyword) : null;
    setDraft(keyword === null || ENGAGEMENT_KEYWORD_PATTERN.test(keyword) ? { ...next, caption: dneskaiCaptionWithKeyword(next.caption, keyword) } : next);
  };
  const engagement = draft.engagement;
  const set = (patch: Partial<EngagementDraft>) => onDraft({ ...draft, engagement: { ...engagement!, ...patch } });
  const keyword = engagement ? dneskaiEngagementKeyword(engagement.keyword) : '';
  const keywordValid = ENGAGEMENT_KEYWORD_PATTERN.test(keyword);
  const keywordWrong = !!engagement && keyword !== '' && !keywordValid;
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-3 border-t border-border pt-4" data-testid="dneskai-engagement">
    <div className="space-y-1">
      <h3 id={`${id}-title`} className="text-sm font-semibold">{t.title}</h3>
      <p className="text-xs text-foreground-muted">{engagement ? t.intro : t.none}</p>
    </div>
    {!engagement ? <Button type="button" variant="outline" size="sm" data-testid="dneskai-engagement-add" onClick={() => onDraft({ ...draft, engagement: newEngagementDraft() })}>{t.add}</Button> : <>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-keyword`} className="text-xs font-medium text-foreground-muted">{t.keyword}</label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Input id={`${id}-keyword`} data-testid="dneskai-engagement-keyword" value={engagement.keyword} maxLength={40} autoCapitalize="characters" autoComplete="off" spellCheck={false}
            aria-invalid={keywordWrong || undefined} aria-describedby={`${id}-keyword-help${keywordWrong ? ` ${id}-keyword-error` : ''}`}
            className={cn('w-40 font-mono uppercase', keywordWrong && 'border-risk')} onChange={(event) => set({ keyword: event.target.value.toUpperCase() })} />
          {keywordValid && <span className="inline-flex items-center gap-1 rounded-full border border-border bg-surface-inset px-2.5 py-1 text-xs" data-testid="dneskai-engagement-chip">
            <span className="text-foreground-muted">{t.keywordChip}</span><span className="font-mono font-semibold">{keyword}</span></span>}
        </div>
        <p id={`${id}-keyword-help`} className="text-xs text-foreground-muted">{t.keywordHelp}</p>
        {keywordWrong && <p id={`${id}-keyword-error`} className="text-xs font-medium text-risk">{t.keywordInvalid}</p>}
      </div>
      <CountedField id={`${id}-message`} label={t.message} value={engagement.replyMessage} max={ENGAGEMENT_REPLY_MESSAGE_MAX} count={value => value.trim().length} multiline rows={6} help={t.messageHelp} lang={lang} onChange={(replyMessage) => set({ replyMessage })} />
      <figure className="min-w-0 space-y-1" aria-labelledby={`${id}-preview`} data-testid="dneskai-engagement-preview">
        <figcaption id={`${id}-preview`} className="text-xs font-medium text-foreground-muted">{t.preview}</figcaption>
        <div className="rounded-md border border-border bg-surface-inset p-3">
          <p className="mb-2 text-[11px] text-foreground-muted">@{handle}</p>
          <p role="region" tabIndex={0} aria-labelledby={`${id}-preview`} className={cn('focus-ring max-h-64 max-w-[85%] overflow-y-auto whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-surface px-3 py-2 text-sm shadow-sm', !engagement.replyMessage.trim() && 'text-foreground-muted')}>
            {engagement.replyMessage.trim() || t.previewEmpty}</p>
        </div>
      </figure>
      <CountedField id={`${id}-reply`} label={t.publicReply} value={engagement.publicReply} max={ENGAGEMENT_PUBLIC_REPLY_MAX} count={value => value.trim().length} help={t.publicReplyHelp} lang={lang} onChange={(publicReply) => set({ publicReply })} />
      <p className="text-xs text-foreground-muted">{t.notLive}</p>
      <Button type="button" variant="ghost" size="sm" data-testid="dneskai-engagement-remove" onClick={() => onDraft({ ...draft, engagement: null })}>{t.remove}</Button>
    </>}
  </section>;
}
