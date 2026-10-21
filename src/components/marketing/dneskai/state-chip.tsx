'use client';

import { StatusBadge } from '@/components/ui/status-badge';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { DNESKAI_STATE_TONES, type DneskaiPostStateDetail } from '@/lib/marketing/dneskai-workspace';

/** A post's state as colour, marker and text together (#119). */
export function DneskaiStateChip({ detail, lang }: { detail: DneskaiPostStateDetail; lang: 'en' | 'cs' }) {
  const t = dneskaiWorkspace[lang];
  const label = detail.publishing ? t.publishingNow : t.states[detail.state];
  return <StatusBadge value={`dneskai-${detail.state}`} label={label} tone={DNESKAI_STATE_TONES[detail.state]} className="shrink-0" />;
}
