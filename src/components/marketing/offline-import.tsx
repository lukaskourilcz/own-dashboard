'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { previewOfflineImports, type OfflineImportPreview } from '@/lib/marketing/offline-import-client';

export function OfflineDraftImport({ lang, disabled = false, onImported }: { lang: string; disabled?: boolean; onImported: () => void }) {
  const cs = lang === 'cs';
  const [drafts, setDrafts] = useState<OfflineImportPreview[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const selection = useRef(0);
  const importing = useRef(false);
  const stopped = useRef(false);
  useEffect(() => () => { stopped.current = true; }, []);
  async function select(files: File[]) {
    const current = ++selection.current; setDrafts([]); setMessage(''); setBusy(true);
    try {
      const preview = await previewOfflineImports(files);
      if (selection.current === current) setDrafts(preview);
    } catch {
      if (selection.current === current) setMessage(cs ? 'Vyber připravené soubory pro import: nejvýše 42 JSON, každý do 4 MB a celkem do 25 MB. Každý musí patřit jinému termínu v kalendáři.' : 'Choose prepared import files: up to 42 JSON files, 4 MB each and 25 MB total. Each must belong to a different calendar slot.');
    } finally { if (selection.current === current) setBusy(false); }
  }
  async function upload() {
    if (disabled || busy || importing.current || !drafts.length) return;
    importing.current = true; stopped.current = false; setUploading(true); setBusy(true); setMessage(''); let completed = 0;
    try {
      for (const draft of drafts) {
        if (stopped.current) break;
        const response = await fetch('/api/marketing/offline-import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: draft.body });
        if (!response.ok) throw new Error('import-held');
        completed++;
        setMessage(cs ? `Uloženo ${completed} z ${drafts.length} návrhů. Zatím nejsou schválené.` : `Saved ${completed} of ${drafts.length} drafts. They are not approved.`);
      }
      setDrafts(previous => previous.slice(completed));
      if (stopped.current) setMessage(cs ? `Import zastaven. Uloženo ${completed} návrhů, zbytek zůstává nepřenesený.` : `Import stopped. Saved ${completed} drafts; the rest have not been transferred.`);
    } catch {
      setDrafts(previous => previous.slice(completed));
      setMessage(cs ? `Uloženo ${completed} návrhů. Další import se zastavil: ověř nastavení, připojený účet a platnost zdroje nebo kalendáře. Neúspěšný krok se automaticky neopakuje.` : `Saved ${completed} drafts. Further import stopped: check setup, the connected account and the current source or calendar. The failed step is not retried automatically.`);
    } finally {
      if (completed) onImported();
      importing.current = false; setUploading(false); setBusy(false);
    }
  }
  return <details className="mb-5 rounded-lg border border-border bg-surface p-4">
    <summary className="cursor-pointer text-sm font-semibold">{cs ? 'Převzít připravené návrhy' : 'Import prepared drafts'}</summary>
    <p className="mt-3 text-xs text-foreground-muted">{cs ? 'Tento krok slouží k převzetí hotového balíčku při nastavení. Uloží návrhy ke kontrole, nic neschvaluje ani nepublikuje. Nový formát Stories potřebuje i kontrolu grafiky. Import musí být v prostředí povolený.' : 'Use this setup step to bring in a prepared bundle. It saves drafts for review without approving or publishing anything. The new Story layout also needs visual review. Import must be enabled in this environment.'}</p>
    <label className="mt-3 block text-xs">{cs ? 'Připravené soubory pro import' : 'Prepared import files'}<Input className="mt-1" type="file" accept="application/json,.json" multiple disabled={disabled || busy} onChange={event => void select(Array.from(event.target.files ?? []))}/></label>
    {drafts.length > 0 && <div className="mt-3 space-y-3"><p className="text-xs">{cs ? `${drafts.length} návrhů · ${drafts[0].date} – ${drafts.at(-1)?.date}` : `${drafts.length} drafts · ${drafts[0].date} – ${drafts.at(-1)?.date}`}</p><Button disabled={disabled || busy} onClick={() => void upload()}>{cs ? 'Uložit návrhy ke kontrole' : 'Save drafts for review'}</Button></div>}
    {uploading && <Button className="mt-3" variant="outline" onClick={() => { stopped.current = true; setMessage(cs ? 'Dokončí se právě ukládaný návrh a import se zastaví.' : 'Import will stop after the current draft has finished saving.'); }}>{cs ? 'Zastavit po tomto návrhu' : 'Stop after this draft'}</Button>}
    {message && <p role="status" className="mt-3 text-xs">{message}</p>}
  </details>;
}
