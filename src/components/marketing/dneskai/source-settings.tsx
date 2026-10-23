'use client';

import { useId, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { useGuardedNavigation } from '@/components/navigation-guard';
import { dneskaiSourceList } from '@/lib/i18n/sections/dneskai-source-list';
import { dneskaiDailyMix } from '@/lib/i18n/sections/dneskai-daily-mix';
import { dneskaiAudio } from '@/lib/i18n/sections/dneskai-audio';
import { cn } from '@/lib/utils';

const Sources = dynamic(() => import('../dneskai-source-list').then(module => module.DneskaiSourceList));
const DailyMix = dynamic(() => import('../dneskai-daily-mix').then(module => module.DneskaiDailyMixPanel));
const Music = dynamic(() => import('../dneskai-audio-library').then(module => module.DneskaiAudioLibrary));
const sections = ['sources', 'mix', 'music'] as const;
type Section = typeof sections[number];
function read(): Section {
  const value = new URLSearchParams(window.location.search).get('sourceSection');
  return sections.find(section => section === value) ?? 'sources';
}
function subscribe(changed: () => void) {
  window.addEventListener('source-section', changed); window.addEventListener('popstate', changed);
  return () => { window.removeEventListener('source-section', changed); window.removeEventListener('popstate', changed); };
}

/** Each settings destination mounts only its own reads and preserves a direct URL. */
export function DneskaiSourceSettings({ projectId, lang, preview = false }: { projectId: string; lang: 'en' | 'cs'; preview?: boolean }) {
  const active = useSyncExternalStore(subscribe, read, () => 'sources' as Section);
  const navigate = useGuardedNavigation();
  const id = useId();
  const labels = { sources: dneskaiSourceList[lang].title, mix: dneskaiDailyMix[lang].title, music: dneskaiAudio[lang].title };
  const choose = (section: Section) => {
    if (section === active) return;
    navigate(() => {
      const url = new URL(window.location.href); url.searchParams.set('sourceSection', section);
      window.history.replaceState(window.history.state, '', url); window.dispatchEvent(new Event('source-section'));
      document.getElementById(`${id}-${section}`)?.focus();
    });
  };
  return <div className="space-y-5" data-testid="dneskai-source-settings">
    <div role="tablist" aria-label={dneskaiSourceList[lang].sections} className="flex gap-1 overflow-x-auto border-b border-border pb-2">
      {sections.map((section, index) => <button key={section} id={`${id}-${section}`} role="tab" aria-selected={active === section} aria-controls={`${id}-panel`} tabIndex={active === section ? 0 : -1}
        onClick={() => choose(section)} onKeyDown={event => {
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? sections.length - 1 : event.key === 'ArrowRight' ? (index + 1) % sections.length : event.key === 'ArrowLeft' ? (index + sections.length - 1) % sections.length : null;
          if (next !== null) { event.preventDefault(); choose(sections[next]!); }
        }} className={cn('min-h-11 shrink-0 rounded-md px-3 text-sm font-medium focus-ring md:min-h-8', active === section ? 'bg-accent text-accent-foreground' : 'text-foreground-muted hover:bg-surface-hover')}>{labels[section]}</button>)}
    </div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${active}`}>
      {active === 'sources' && <Sources projectId={projectId} lang={lang} preview={preview} />}
      {active === 'mix' && <DailyMix projectId={projectId} lang={lang} preview={preview} />}
      {active === 'music' && <Music lang={lang} preview={preview} />}
    </div>
  </div>;
}
