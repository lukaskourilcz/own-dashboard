'use client';
import { useLayoutEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase/client';
import { useOwnerPreferences } from '@/lib/owner-preferences';
import { watchOwnerSession } from '@/lib/owner-session';
import { ownerRestIdentityMatches } from '@/lib/owner-rest-identity';
import { watchOwnerRetirement } from '@/lib/owner-retirement';
import { fetchWithSignal } from '@/lib/abortable';
import { guestProtectedUrl } from '@/lib/guest-requests';
import { useDict } from '@/lib/i18n';
import { Button } from '@/components/ui/button';

/** A locked scope stays retired until a full document load verifies the owner
 * server-side again. It cannot adopt a client session or reuse its old cache. */
export function OwnerSessionBoundary({ enabled, children }: { enabled: boolean; children: ReactNode }) {
 const owner = useOwnerPreferences(), client = useQueryClient(), t = useDict().common;
 const [retired, setRetired] = useState(false);
 useLayoutEffect(() => {
  if (!enabled) return;
  const lifetime = new AbortController(), original = window.fetch;
  const bounded = fetchWithSignal(lifetime.signal, (input, init) => original.call(window, input, init));
  const retire = () => {
   if (lifetime.signal.aborted) return;
   lifetime.abort(); owner?.dispose();
   void client.cancelQueries().catch(() => undefined); client.clear(); setRetired(true);
  };
  const guarded: typeof fetch = (input, init) => {
   if (!ownerRestIdentityMatches(input, init, process.env.NEXT_PUBLIC_SUPABASE_URL, window.location.origin, owner?.ownerId)) {
    retire(); return Promise.reject(new DOMException('Owner session changed', 'AbortError'));
   }
   const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
   return guestProtectedUrl(url, window.location.origin, process.env.NEXT_PUBLIC_SUPABASE_URL) ? bounded(input, init) : original.call(window, input, init);
  };
  window.fetch = guarded;
  const stopRetirement = watchOwnerRetirement(lifetime.signal, retire);
  let stop = () => {};
  if (!owner?.ownerId) retire();
  else try { stop = watchOwnerSession(createClient(), owner.ownerId, lifetime.signal, retire); } catch { retire(); }
  return () => { stop(); stopRetirement(); lifetime.abort(); if (window.fetch === guarded) window.fetch = original; };
 }, [client, enabled, owner]);
 if (!retired) return children;
 return <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-3 px-5 py-10">
  <h1 className="text-lg font-semibold">{t.sessionChanged}</h1>
  <p role="alert" className="text-sm text-foreground-muted">{t.sessionChangedDescription}</p>
  <Button className="self-start" onClick={() => window.location.reload()}>{t.sessionReload}</Button>
 </main>;
}
