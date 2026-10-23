'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { qk } from '@/lib/queries/keys';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { loadDneskaiAudioOptions } from '@/lib/marketing/dneskai-audio-client';
import { cn } from '@/lib/utils';

type Format = 'carousel' | 'reel';
type Props = { value: string; onChange: (format: Format) => void; preview: boolean; disabled?: boolean; lang: 'en' | 'cs' };

/**
 * Formát (#165): a carousel deck publishes as a carousel or as a Reel. Part of the revision and its hash. Shown only
 * while Reels are switched on (the audio library answers), and only for a carousel deck.
 */
export function DneskaiFormatSwitch({ value, onChange, preview, disabled = false, lang }: Props) {
  const t = dneskaiAudio[lang].format;
  const id = useId();
  const query = useQuery({ queryKey: [...qk.dneskaiAudio, preview], retry: false, staleTime: 30000, queryFn: ({ signal }) => loadDneskaiAudioOptions(preview, signal) });
  if (!query.data || (value !== 'carousel' && value !== 'reel')) return null;
  return <fieldset className="min-w-0 space-y-1" disabled={disabled} aria-describedby={`${id}-help`} data-testid="dneskai-format-switch">
    <legend className="text-xs font-medium">{t.label}</legend>
    <div role="radiogroup" aria-label={t.label} className="inline-flex rounded-md border border-border p-0.5">
      {(['carousel', 'reel'] as const).map((format) => <button key={format} type="button" role="radio" aria-checked={value === format}
        className={cn('focus-ring min-h-11 min-w-24 rounded px-3 text-sm', value === format ? 'bg-surface-muted font-medium text-foreground' : 'text-foreground-muted')}
        onClick={() => onChange(format)}>{t[format]}</button>)}
    </div>
    <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.help}</p>
  </fieldset>;
}
