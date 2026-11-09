'use client';

import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { dneskaiClosing } from '@/lib/i18n/sections/dneskai-closing';

type ClosingSettings = { enabled: boolean; headline: string; body: string; handle: string };

/**
 * The closing slide's own section in the Design Lab (owner, 9 November 2026): its words, a preview drawn by the same
 * code as the render, and the switch that lets the plan add it to planned carousels. Off until the owner turns it on.
 */
export function DneskaiClosingPanel({ lang, disabled }: { lang: 'en' | 'cs'; disabled?: boolean }) {
  const t = dneskaiClosing[lang];
  const id = useId();
  const [settings, setSettings] = useState<ClosingSettings | null>(null);
  const [saved, setSaved] = useState<ClosingSettings | null>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [previewKey, setPreviewKey] = useState('');
  useEffect(() => {
    if (disabled) return;
    let ignore = false;
    fetch('/api/marketing/dneskai/closing', { cache: 'no-store' }).then((response) => response.ok ? response.json() : null).then((value: ClosingSettings | null) => {
      if (ignore || !value) return;
      const next = { enabled: value.enabled, headline: value.headline, body: value.body, handle: value.handle };
      setSettings(next); setSaved(next);
    }).catch(() => undefined);
    return () => { ignore = true; };
  }, [disabled]);
  // The preview follows the words half a second after the last keystroke.
  useEffect(() => {
    if (!settings) return;
    const timer = window.setTimeout(() => setPreviewKey(new URLSearchParams({ preview: '1', headline: settings.headline, body: settings.body, handle: settings.handle }).toString()), 500);
    return () => window.clearTimeout(timer);
  }, [settings]);
  const dirty = !!settings && !!saved && JSON.stringify(settings) !== JSON.stringify(saved);
  const save = async () => {
    if (!settings) return;
    setState('saving');
    const response = await fetch('/api/marketing/dneskai/closing', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }).catch(() => null);
    if (!response?.ok) { setState('failed'); return; }
    const value = (await response.json()) as ClosingSettings;
    const next = { enabled: value.enabled, headline: value.headline, body: value.body, handle: value.handle };
    setSettings(next); setSaved(next); setState('saved');
  };
  return <details className="rounded-md border border-border p-3" data-testid="dneskai-closing-panel">
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-medium">{t.title}{saved ? ` · ${saved.enabled ? '✓' : '—'}` : ''}</summary>
    <div className="mt-2 grid gap-4 md:grid-cols-[minmax(0,1fr)_16rem]">
      <div className="space-y-3">
        <p className="text-xs text-foreground-muted">{t.help}</p>
        {!settings ? <p role="status" className="text-xs text-foreground-muted">{t.loading}</p> : <>
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
            <Button type="button" size="sm" disabled={disabled || !dirty || state === 'saving'} onClick={save}>{state === 'saving' ? t.saving : t.save}</Button>
            {state === 'saved' && <p role="status" className="text-xs text-foreground-muted">{t.saved}</p>}
            {state === 'failed' && <p role="alert" className="text-xs text-danger">{t.failed}</p>}
          </div>
        </>}
      </div>
      <figure className="space-y-1">
        <figcaption className="text-xs font-medium">{t.preview}</figcaption>
        {/* eslint-disable-next-line @next/next/no-img-element -- a private, uncached PNG from the owner's own route */}
        {previewKey && <img src={`/api/marketing/dneskai/closing?${previewKey}`} alt={t.previewAlt} width={1080} height={1350} className="h-auto w-full rounded-sm border border-border" />}
      </figure>
    </div>
  </details>;
}
