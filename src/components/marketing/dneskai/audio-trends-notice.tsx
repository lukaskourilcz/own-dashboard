'use client';

import { Button } from '@/components/ui/button';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import type { DneskaiAudioTrendsStatus } from '@/lib/marketing/dneskai-audio-contracts';

/** The same optional-read recovery in the library and post picker. */
export function DneskaiAudioTrendsNotice({status, empty = false, lang, pending, onRetry}: {
  status: DneskaiAudioTrendsStatus | undefined;
  empty?: boolean;
  lang: 'en' | 'cs';
  pending: boolean;
  onRetry: () => void;
}) {
  const t = dneskaiAudio[lang].trends;
  if (status === 'disabled' || (status === 'ready' && !empty)) return null;
  if (status === 'ready') return <p role="status" className="text-sm text-foreground-muted">{t.empty}</p>;
  return <DneskaiAudioReadNotice message={t.unavailable} retryLabel={t.retry} pending={pending} onRetry={onRetry} role="status" testId="dneskai-audio-trends-notice" />;
}

/** Compact recovery beside retained library data, with a full mobile target. */
export function DneskaiAudioReadNotice({message, retryLabel, pending, onRetry, role = 'alert', testId = 'dneskai-audio-read-notice'}: {
  message: string; retryLabel: string; pending: boolean; onRetry: () => void;
  role?: 'alert' | 'status'; testId?: string;
}) {
  return <div className="flex w-full min-w-0 flex-col gap-2 sm:w-fit sm:max-w-full sm:flex-row sm:items-center" data-testid={testId}>
    <p role={role} className="text-sm text-foreground-muted">{message}</p>
    <Button type="button" variant="outline" disabled={pending} aria-busy={pending} className="w-full shrink-0 sm:w-auto" onClick={onRetry}>{retryLabel}</Button>
  </div>;
}
