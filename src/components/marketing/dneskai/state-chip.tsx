'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { DNESKAI_STATE_TONES, type DneskaiPostStateDetail } from '@/lib/marketing/dneskai-workspace';

type Tone = (typeof DNESKAI_STATE_TONES)[keyof typeof DNESKAI_STATE_TONES];

/** The card tint of each tone (#173). The state-to-tone mapping stays in DNESKAI_STATE_TONES. */
export const DNESKAI_TONE_TINTS: Record<Tone, string> = {
  success: 'dneskai-tint-success border-success/25',
  information: 'dneskai-tint-information border-information/25',
  warning: 'dneskai-tint-warning border-warning/25',
  risk: 'dneskai-tint-risk border-risk/25',
  neutral: 'dneskai-tint-neutral border-border',
};

/** The words for a post's state, which a tinted card keeps in its accessible name and its tooltip. */
export function dneskaiStateText(detail: DneskaiPostStateDetail, lang: 'en' | 'cs'): string {
  const t = dneskaiWorkspace[lang];
  return detail.publishing ? t.publishingNow : t.states[detail.state];
}

/** The tint and border classes for a card in this state. */
export const dneskaiStateTint = (detail: DneskaiPostStateDetail) => DNESKAI_TONE_TINTS[DNESKAI_STATE_TONES[detail.state]];

/** A post's state as colour, marker and text together (#119). */
export function DneskaiStateChip({ detail, lang }: { detail: DneskaiPostStateDetail; lang: 'en' | 'cs' }) {
  return <StatusBadge value={`dneskai-${detail.state}`} label={dneskaiStateText(detail, lang)} tone={DNESKAI_STATE_TONES[detail.state]} className="shrink-0" />;
}
