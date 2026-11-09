'use client';

import { useEffect, useId, useState } from 'react';
import Image from 'next/image';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { dneskaiClosing } from '@/lib/i18n/sections/dneskai-closing';
import { DNESKAI_CLOSING_DEFAULTS, type DneskaiClosingWords } from '@/lib/marketing/dneskai-closing';
import previewCard from '../../../../../templates/carousel-studio/brand-kits/caught-up/dneskai-closing-card.png';

type ClosingSettings = DneskaiClosingWords & { enabled: boolean };

/**
 * The closing card's text, preview and switch for planned carousels.
 */
export function DneskaiPromoSlide({ lang, preview }: { lang: 'en' | 'cs'; preview: boolean }) {
  const t = dneskaiClosing[lang];
  const id = useId();
  const [settings, setSettings] = useState<ClosingSettings | null>(() => preview ? { enabled: false, ...DNESKAI_CLOSING_DEFAULTS } : null);
  const [saved, setSaved] = useState<ClosingSettings | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed' | 'load-failed'>('idle');
  const [reload, setReload] = useState(0);
  const [previewKey, setPreviewKey] = useState('');
  const disabled = preview || state === 'saving';
  useEffect(() => {
    if (preview) return;
    const controller = new AbortController();
    fetch('/api/marketing/dneskai/closing', { cache: 'no-store', signal: controller.signal }).then((response) => {
      if (!response.ok) throw new Error('closing-unavailable');
      return response.json() as Promise<ClosingSettings>;
    }).then((value) => {
      if (controller.signal.aborted) return;
      const next = { enabled: value.enabled, headline: value.headline, body: value.body, handle: value.handle };
      setSettings(next); setSaved(next);
    }).catch(() => { if (!controller.signal.aborted) setState('load-failed'); });
    return () => controller.abort();
  }, [preview, reload]);
  // The preview follows the words half a second after the last keystroke.
  useEffect(() => {
    if (preview || !settings) return;
    const timer = window.setTimeout(() => setPreviewKey(new URLSearchParams({ preview: '1', headline: settings.headline, body: settings.body, handle: settings.handle }).toString()), 500);
    return () => window.clearTimeout(timer);
  }, [preview, settings]);
  const dirty = !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved);
  const save = async () => {
    if (disabled || !settings || !dirty) return;
    setState('saving');
    try {
      const response = await fetch('/api/marketing/dneskai/closing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
      if (!response.ok) throw new Error('closing-save-failed');
      const value = await response.json() as ClosingSettings;
      const next = { enabled: value.enabled, headline: value.headline, body: value.body, handle: value.handle };
      setSettings(next); setSaved(next); setState('saved');
    } catch { setState('failed'); }
  };
  return <section aria-labelledby={`${id}-title`} className="min-w-0 space-y-4" data-testid="dneskai-closing-panel">
    <header className="space-y-1">
      <h2 id={`${id}-title`} className="text-lg font-semibold">{t.title}</h2>
      <p className="text-sm text-foreground-muted">{t.help}</p>
    </header>
    <div className="grid gap-5 md:grid-cols-[minmax(12rem,1fr)_minmax(0,2fr)]">
      <figure className="w-full max-w-72 space-y-1">
        <figcaption className="text-xs font-medium">{t.preview}</figcaption>
        {preview ? <Image src={previewCard} alt={t.previewAlt} className="h-auto w-full rounded-md border border-border" />
          // eslint-disable-next-line @next/next/no-img-element -- a private, uncached PNG from the owner's own route
          : previewKey && <img src={`/api/marketing/dneskai/closing?${previewKey}`} alt={t.previewAlt} width={1080} height={1350} className="h-auto w-full rounded-md border border-border" />}
      </figure>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        {state === 'load-failed' ? <>
          <p role="alert" className="text-sm text-risk">{t.unavailable}</p>
          <Button type="button" size="sm" variant="outline" onClick={() => { setState('idle'); setReload(reload + 1); }}>{t.retry}</Button>
        </> : !settings ? <p role="status" className="text-xs text-foreground-muted">{t.loading}</p> : <>
          <label className="flex min-h-11 items-center gap-3 text-sm" htmlFor={`${id}-auto`}>
            <Switch id={`${id}-auto`} checked={settings.enabled} disabled={disabled} onCheckedChange={(enabled) => { setSettings({ ...settings, enabled }); setState('idle'); }} />
            {t.auto}
          </label>
          <div className="space-y-1"><label className="text-xs font-medium" htmlFor={`${id}-headline`}>{t.headline}</label>
            <Input id={`${id}-headline`} value={settings.headline} maxLength={24} disabled={disabled} onChange={(event) => { setSettings({ ...settings, headline: event.target.value }); setState('idle'); }} /></div>
          <div className="space-y-1"><label className="text-xs font-medium" htmlFor={`${id}-body`}>{t.body}</label>
            <Input id={`${id}-body`} value={settings.body} maxLength={160} disabled={disabled} onChange={(event) => { setSettings({ ...settings, body: event.target.value }); setState('idle'); }} /></div>
          <div className="space-y-1"><label className="text-xs font-medium" htmlFor={`${id}-handle`}>{t.handle}</label>
            <Input id={`${id}-handle`} value={settings.handle} maxLength={31} disabled={disabled} onChange={(event) => { setSettings({ ...settings, handle: event.target.value }); setState('idle'); }} /></div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={disabled || !dirty}>{state === 'saving' ? t.saving : t.save}</Button>
            {state === 'saved' && <p role="status" className="text-xs text-foreground-muted">{t.saved}</p>}
            {state === 'failed' && <p role="alert" className="text-xs text-risk">{t.failed}</p>}
          </div>
        </>}
      </form>
    </div>
  </section>;
}
