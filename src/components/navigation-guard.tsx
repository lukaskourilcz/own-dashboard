'use client';

import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useDict } from '@/lib/i18n';

const HISTORY_INDEX = 'ownDashboardIndex';
type Draft = { dirty: boolean; canSave: boolean; save: () => Promise<boolean>; discard?: () => void };
type Navigation = () => void;
type Guard = { request: (action: Navigation) => void; register: (key: symbol, draft: Draft) => () => void };
const unguarded: Guard = { request: action => action(), register: () => () => {} };
const NavigationContext = createContext<Guard>(unguarded);

/** Next integrates native pushState with its router; pass only the shell's public state. */
export function pushDashboardHistory(url: string) {
  const index = Number(window.history.state?.[HISTORY_INDEX] ?? 0);
  window.history.pushState({ [HISTORY_INDEX]: index + 1 }, '', url);
  window.dispatchEvent(new Event('own-dashboard-navigation'));
}

/** One guard above the persistent shell: tab, project, link, history and document exits share the same dirty state. */
export function NavigationGuardProvider({ children }: { children: ReactNode }) {
  const t = useDict().common.unsaved;
  const drafts = useRef(new Map<symbol, Draft>());
  const bypass = useRef(false);
  const [pending, setPending] = useState<Navigation | null>(null);
  const pendingRef = useRef<Navigation | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [failed, setFailed] = useState(false);
  const [canSave, setCanSave] = useState(false);
  const register = useCallback<Guard['register']>((key, draft) => {
    drafts.current.set(key, draft);
    const update = () => { const dirty = [...drafts.current.values()].filter(item => item.dirty); setCanSave(dirty.length > 0 && dirty.every(item => item.canSave)); };
    update();
    return () => { drafts.current.delete(key); update(); };
  }, []);
  const request = useCallback((action: Navigation) => {
    if (bypass.current || ![...drafts.current.values()].some(draft => draft.dirty)) { action(); return; }
    if (pendingRef.current) return;
    pendingRef.current = action;
    setFailed(false);
    setPending(() => action);
  }, []);
  const stay = () => {
    if (savingRef.current) return;
    pendingRef.current = null;
    setPending(null);
    setFailed(false);
  };
  const proceed = (discard = false) => {
    const action = pendingRef.current;
    if (discard) for (const draft of drafts.current.values()) if (draft.dirty) draft.discard?.();
    pendingRef.current = null;
    setPending(null);
    drafts.current.clear();
    bypass.current = true;
    try { action?.(); } finally { bypass.current = false; }
  };
  const save = async () => {
    if (savingRef.current) return;
    const dirty = [...drafts.current.values()].filter(draft => draft.dirty);
    if (!dirty.length || dirty.some(draft => !draft.canSave)) return;
    savingRef.current = true; setSaving(true); setFailed(false);
    try {
      for (const draft of dirty) { if (!await draft.save()) { setFailed(true); return; } }
      proceed();
    } catch { setFailed(true); }
    finally { savingRef.current = false; setSaving(false); }
  };
  // Install before the shell’s passive history listeners can unmount a dirty editor.
  useLayoutEffect(() => {
    let currentIndex = Number(window.history.state?.[HISTORY_INDEX] ?? 0);
    window.history.replaceState({ ...window.history.state, [HISTORY_INDEX]: currentIndex }, '', window.location.href);
    let restoring = false;
    let afterRestore: Navigation | null = null;
    const onPush = () => { currentIndex = Number(window.history.state?.[HISTORY_INDEX] ?? currentIndex); };
    const onPop = (event: PopStateEvent) => {
      if (restoring) {
        event.stopImmediatePropagation();
        if (typeof event.state?.[HISTORY_INDEX] === 'number' && event.state[HISTORY_INDEX] !== currentIndex) { window.history.go(currentIndex - event.state[HISTORY_INDEX]); return; }
        restoring = false;
        const action = afterRestore; afterRestore = null; action?.();
        return;
      }
      const targetIndex = event.state?.[HISTORY_INDEX];
      if (typeof targetIndex !== 'number') return; // Cross-document exits also have the native beforeunload guard.
      const delta = targetIndex - currentIndex;
      if (delta && [...drafts.current.values()].some(draft => draft.dirty)) {
        event.stopImmediatePropagation();
        restoring = true;
        window.history.go(-delta);
        request(() => {
          const resume = () => window.history.go(delta);
          if (restoring) afterRestore = resume; else resume();
        });
      } else currentIndex = targetIndex;
    };
    const onLink = (event: MouseEvent) => {
      if (bypass.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download') || anchor.getAttribute('href')?.startsWith('#') || anchor.href === window.location.href) return;
      if (![...drafts.current.values()].some(draft => draft.dirty)) return;
      event.preventDefault(); event.stopPropagation();
      request(() => anchor.click());
    };
    const onUnload = (event: BeforeUnloadEvent) => {
      if (!bypass.current && [...drafts.current.values()].some(draft => draft.dirty)) event.preventDefault();
    };
    window.addEventListener('own-dashboard-navigation', onPush);
    window.addEventListener('popstate', onPop, true);
    document.addEventListener('click', onLink, true);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('own-dashboard-navigation', onPush);
      window.removeEventListener('popstate', onPop, true);
      document.removeEventListener('click', onLink, true);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [request]);
  const value = useMemo(() => ({ request, register }), [request, register]);
  return <NavigationContext.Provider value={value}>{children}
    <Dialog open={pending !== null} onOpenChange={open => { if (!open) stay(); }}>
      <DialogContent className="max-w-md" onEscapeKeyDown={event => { if (saving) event.preventDefault(); }} onPointerDownOutside={event => { if (saving) event.preventDefault(); }}>
        <DialogHeader><DialogTitle>{t.title}</DialogTitle><DialogDescription>{t.description}</DialogDescription></DialogHeader>
        {failed && <p role="alert" className="text-sm text-risk">{t.failed}</p>}
        {!canSave && !saving && <p className="text-sm text-foreground-muted">{t.invalid}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={stay}>{t.stay}</Button>
          <Button variant="ghost" disabled={saving} onClick={() => proceed(true)}>{t.discard}</Button>
          <Button disabled={!canSave || saving} aria-busy={saving} onClick={() => void save()}>{saving ? t.saving : t.save}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </NavigationContext.Provider>;
}

export function useGuardedNavigation() { return useContext(NavigationContext).request; }
export function useUnsavedDraft(draft: Draft) {
  const { register } = useContext(NavigationContext);
  const key = useMemo(() => Symbol('draft'), []);
  useLayoutEffect(() => register(key, draft), [key, register, draft]);
}
