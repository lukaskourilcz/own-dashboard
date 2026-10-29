'use client';

import { useId } from 'react';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { useDneskaiAudioLibrary } from '@/lib/marketing/dneskai-audio-client';
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
  const query = useDneskaiAudioLibrary(preview);
  if (!query.data || (value !== 'carousel' && value !== 'reel')) return null;
  return <fieldset className="min-w-0 space-y-1" disabled={disabled} aria-describedby={`${id}-help`} data-testid="dneskai-format-switch">
    <legend className="text-xs font-medium">{t.label}</legend>
    <div role="radiogroup" aria-label={t.label} className="inline-flex rounded-md border border-border p-0.5">
      {(['carousel', 'reel'] as const).map((format) => <label key={format}
        className={cn('inline-flex min-h-11 min-w-24 items-center justify-center rounded px-3 text-sm focus-within:ring-2 focus-within:ring-ring', disabled ? 'cursor-not-allowed' : 'cursor-pointer', value === format ? 'bg-surface-muted font-medium text-foreground' : 'text-foreground-muted')}>
        <input type="radio" name={`${id}-format`} value={format} checked={value === format} onChange={() => onChange(format)} className="sr-only" />{t[format]}
      </label>)}
    </div>
    <p id={`${id}-help`} className="text-xs text-foreground-muted">{t.help}</p>
  </fieldset>;
}
