'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Download, Shield } from 'lucide-react';
import { useDict } from '@/lib/i18n';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { isGuestTour, guestReadOnlyError } from '@/lib/guest-requests';
import { DataDownloadError, fetchDataExport } from '@/lib/data-export-download';
import { exportScopes, type ExportScope } from '@/lib/data-export-scopes';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { SimpleSelect } from '@/components/ui/select';
export function SettingsDataExport({ available }: { available: boolean }) {
 const owner = useOwnerPreferences();
 return <ExportControls key={owner?.ownerId ?? 'unavailable'} owner={owner} available={available} />;
}
function ExportControls({ owner, available }: { owner: ReturnType<typeof useOwnerPreferences>; available: boolean }) {
 const { settings: t } = useDict(), id = useId();
 const [scope, setScope] = useState<ExportScope>('full'), [pending, setPending] = useState(false), [message, setMessage] = useState<'started' | 'unavailable' | 'too-large' | 'account' | 'preview' | null>(null);
 const reserved = useRef(false), lifetime = useRef(new AbortController()), resources = useRef(new Map<string, ReturnType<typeof setTimeout>>());
 useEffect(() => {
  if (lifetime.current.signal.aborted) lifetime.current = new AbortController();
  const controller = lifetime.current, urls = resources.current;
  return () => { controller.abort(); for (const [url, timer] of urls) { clearTimeout(timer); URL.revokeObjectURL(url); } urls.clear(); };
 }, []);
 const options = [
  { value: 'full', label: t.exportFull }, { value: 'financial', label: t.exportFinancial }, { value: 'professional', label: t.exportProfessional },
  { value: 'knowledge', label: t.exportKnowledge }, { value: 'projects', label: t.exportProjects }, { value: 'notes', label: t.exportNotes },
  { value: 'prompts', label: t.exportPrompts }, { value: 'career', label: t.exportCareer }, { value: 'legacy', label: t.exportLegacy },
 ];
 async function download(selected: ExportScope | 'transactions-csv') {
  if (isGuestTour()) { guestReadOnlyError(); return; }
  if (reserved.current) return;
  if (!available || !owner) { setMessage('preview'); return; }
  const captured = owner.capture(), signal = AbortSignal.any([captured.signal, lifetime.current.signal]);
  if (signal.aborted) return;
  reserved.current = true; setPending(true); setMessage(null);
  let url: string | undefined;
  try {
   const file = await fetchDataExport(captured.ownerId, selected, signal); signal.throwIfAborted();
   url = URL.createObjectURL(file.blob);
   const anchor = document.createElement('a');
   try { anchor.href = url; anchor.download = file.name; document.body.appendChild(anchor); anchor.click(); }
   finally { anchor.remove(); }
   const allocated = url;
   resources.current.set(allocated, setTimeout(() => { URL.revokeObjectURL(allocated); resources.current.delete(allocated); }, 60_000));
   setMessage('started');
  } catch (error) {
   if (url) URL.revokeObjectURL(url);
   if (!signal.aborted) setMessage(error instanceof DataDownloadError ? error.reason : 'unavailable');
  } finally { reserved.current = false; if (!signal.aborted) setPending(false); }
 }
 const error = message === 'unavailable' ? t.exportFailed : message === 'too-large' ? t.exportTooLarge : message === 'account' ? t.exportAccountChanged : null;
 return <Card id="settings-export" className="scroll-mt-4">
  <CardHeader><CardTitle className="inline-flex items-center gap-1.5"><Shield className="h-3 w-3" aria-hidden="true" />{t.dataExport}</CardTitle></CardHeader>
  <CardContent className="space-y-3">
   <p id={`${id}-description`} className="max-w-prose text-xs text-foreground-subtle">{t.dataExportDesc}</p>
   <div className="flex flex-wrap items-end gap-3">
    <div className="min-w-0 flex-[1_1_12rem] space-y-1.5">
     <Label htmlFor={id}>{t.exportDataset}</Label>
     <SimpleSelect id={id} value={scope} options={options} disabled={pending} aria-describedby={`${id}-description`} onValueChange={value => { if (!reserved.current && exportScopes.includes(value as ExportScope)) { setScope(value as ExportScope); setMessage(null); } }} />
    </div>
    <div className="grid min-w-0 flex-[2_1_20rem] grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] gap-2">
     <Button type="button" variant="outline" disabled={pending} onClick={() => void download(scope)}><Download aria-hidden="true" />{t.exportJson}</Button>
     <Button type="button" variant="outline" disabled={pending} onClick={() => void download('transactions-csv')}><Download aria-hidden="true" />{t.exportTransactionsCsv}</Button>
    </div>
   </div>
   {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
   {(pending || message === 'started' || message === 'preview') && <p role="status" className="text-xs text-foreground-muted">{pending ? t.exportPending : message === 'started' ? t.exportStarted : t.exportPreview}</p>}
  </CardContent>
 </Card>;
}
