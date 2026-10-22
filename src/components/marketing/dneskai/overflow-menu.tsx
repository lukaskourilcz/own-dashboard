'use client';

import { useRef, useState, type KeyboardEvent } from 'react';
import dynamic from 'next/dynamic';
import * as Popover from '@radix-ui/react-popover';
import { Ellipsis } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { dneskaiWorkspace } from '@/lib/i18n/sections/dneskai-workspace';
import { dneskaiLab } from '@/lib/i18n/sections/dneskai-lab';
import { useLang } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import type { ProjectTabId } from '@/lib/project-workspace-tabs';

type Lang = 'en' | 'cs';
type Panel = 'costs' | 'account' | 'recovery' | 'shortcuts';
const PANELS: readonly Panel[] = ['costs', 'account', 'recovery', 'shortcuts'];

function Loading() {
  const { lang } = useLang();
  return <p role="status" className="text-sm text-foreground-muted">{dneskaiWorkspace[lang].loading}</p>;
}
// Each panel loads its code only when its dialog opens.
const WorkspaceTab = dynamic(() => import('./workspace').then((module) => module.DneskaiWorkspaceTab), { loading: Loading });
const InstagramAccount = dynamic(() => import('../dneskai-instagram-account').then((module) => module.DneskaiInstagramAccount), { loading: Loading });
const Sources = dynamic(() => import('../dneskai-sources').then((module) => module.DneskaiSources), { loading: Loading });

/**
 * The DNESKAi workspace `⋯` button (#169). Four panels open as dialogs (Errors and costs, the Instagram account, topic
 * recovery, keyboard shortcuts); below them the general project sections, which select their tab.
 */
export function DneskaiOverflowMenu({ projectId, lang, preview, sections, activeSection, onSection, onOpenReview }: {
  projectId: string; lang: Lang; preview: boolean;
  sections: ReadonlyArray<{ id: ProjectTabId; label: string }>; activeSection: ProjectTabId | null;
  onSection: (id: ProjectTabId) => void; onOpenReview: () => void;
}) {
  const t = dneskaiWorkspace[lang].more;
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Up and Down move between the items, Home and End jump to the ends; Tab works as usual.
  const onKeyDown = (event: KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const items = [...(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    if (!items.length) return;
    event.preventDefault();
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[next]!.focus();
  };
  const item = 'flex min-h-11 w-full items-center rounded-md px-2.5 text-left text-sm text-foreground hover:bg-surface-hover focus-ring md:min-h-8';
  return <>
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button ref={trigger} variant="ghost" size="icon" aria-label={t.button} title={t.button} data-testid="dneskai-more" className="shrink-0"><Ellipsis aria-hidden /></Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} aria-label={t.button} onKeyDown={onKeyDown}
          className="z-40 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-surface p-1.5 shadow-elevated" data-testid="dneskai-more-menu">
          <div ref={list}>
            <ul className="space-y-0.5">{PANELS.map((key) => <li key={key}>
              <button type="button" className={item} onClick={() => { setOpen(false); setPanel(key); }}>{t[key]}</button>
            </li>)}</ul>
            {sections.length > 0 && <>
              <p className="mt-2 border-t border-border px-2.5 pb-1 pt-2 text-[11px] font-medium text-foreground-subtle" id="dneskai-more-sections">{t.sections}</p>
              <ul aria-labelledby="dneskai-more-sections" className="space-y-0.5">{sections.map((section) => <li key={section.id}>
                <button type="button" aria-current={activeSection === section.id ? 'page' : undefined} className={cn(item, activeSection === section.id && 'bg-accent')}
                  onClick={() => { setOpen(false); onSection(section.id); }}>{section.label}</button>
              </li>)}</ul>
            </>}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
    <Dialog open={panel !== null} onOpenChange={(next) => { if (!next) setPanel(null); }}>
      <DialogContent className={cn(panel === 'costs' || panel === 'recovery' ? 'max-w-5xl' : 'max-w-xl')} data-testid={panel ? `dneskai-more-${panel}` : undefined}
        {...(panel === 'costs' ? { 'aria-describedby': undefined } : {})} onCloseAutoFocus={(event) => { event.preventDefault(); trigger.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle>{panel ? t[panel] : ''}</DialogTitle>
          {panel && panel !== 'costs' && <DialogDescription>{t[`${panel}Description`]}</DialogDescription>}
        </DialogHeader>
        {panel === 'costs' && <WorkspaceTab tab="dneskai-costs" projectId={projectId} lang={lang} preview={preview} />}
        {panel === 'account' && <InstagramAccount lang={lang} disabled={preview} />}
        {panel === 'recovery' && <Sources projectId={projectId} lang={lang} disabled={preview} onOpenReview={() => { setPanel(null); onOpenReview(); }} />}
        {panel === 'shortcuts' && <dl className="space-y-2 text-xs">{dneskaiLab[lang].shortcuts.rows.map(([key, value]) => <div key={key} className="flex justify-between gap-4"><dt className="font-mono">{key}</dt><dd>{value}</dd></div>)}</dl>}
      </DialogContent>
    </Dialog>
  </>;
}
